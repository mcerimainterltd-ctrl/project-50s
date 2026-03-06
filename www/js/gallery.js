/*
 * gallery.js
 * Xame Gallery — personal & business photo/video showcase.
 * XamePage v2.1
 */

const galleryModule = {
  _currentMode: 'personal',
  _items: [],
  _viewingUserId: null,

  open(userId) {
    this._viewingUserId = userId || USER?.xameId;
    this._render();
    setTimeout(() => this._loadItems(), 100);
  },

  async _loadItems() {
    const grid = document.getElementById('galleryGrid');
    if (grid) grid.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px">Loading...</p>';
    try {
      const res  = await fetch('/api/gallery/' + this._viewingUserId + '?requesterId=' + USER?.xameId);
      const data = await res.json();
      this._items = data.items || [];
      this._renderGrid();
    } catch (err) {
      const grid = document.getElementById('galleryGrid');
      if (grid) grid.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px">Failed to load</p>';
    }
  },

  _render() {
    document.getElementById('galleryOverlay')?.remove();
    const isOwner = this._viewingUserId === USER?.xameId;
    const overlay = document.createElement('div');
    overlay.id        = 'galleryOverlay';
    overlay.className = 'screen';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:var(--dark-bg);display:flex;flex-direction:column;';
    overlay.innerHTML =
      '<header class="header" style="display:flex;align-items:center;gap:12px;padding:12px 16px;">' +
        '<button class="icon-btn" id="galleryBackBtn">←</button>' +
        '<h3 style="flex:1;margin:0">Xame Gallery</h3>' +
        (isOwner ? '<button class="icon-btn" id="galleryUploadBtn" title="Upload">➕</button>' : '') +
      '</header>' +
      '<div class="gallery-tabs">' +
        '<button class="gallery-tab active" data-tab="personal">Personal</button>' +
        '<button class="gallery-tab" data-tab="business">Business</button>' +
      '</div>' +
      '<div id="galleryGrid" class="gallery-grid"></div>';

    document.body.appendChild(overlay);

    overlay.querySelector('#galleryBackBtn').addEventListener('click', () => overlay.remove());

    overlay.querySelectorAll('.gallery-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        overlay.querySelectorAll('.gallery-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        galleryModule._currentMode = tab.dataset.tab;
        galleryModule._renderGrid();
      });
    });

    if (isOwner) {
      overlay.querySelector('#galleryUploadBtn')?.addEventListener('click', function() {
        galleryModule._showUploadDialog();
      });
    }
  },

  _renderGrid() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;
    const filtered = this._items.filter(function(i) { return i.mode === galleryModule._currentMode; });
    if (filtered.length === 0) {
      grid.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:40px">No items yet</p>';
      return;
    }
    const isOwner = this._viewingUserId === USER?.xameId;
    grid.innerHTML = filtered.map(function(item) {
      return '<div class="gallery-item" data-id="' + item._id + '">' +
        (item.type === 'video'
          ? '<canvas class="gallery-thumb gallery-video-canvas" data-src="' + item.url + '"></canvas><div class="gallery-play-icon">▶</div>'
          : '<img src="' + item.url + '" class="gallery-thumb" loading="lazy" alt="">') +
        (item.price ? '<div class="gallery-price">&#8358;' + escapeHtml(item.price) + '</div>' : '') +
        (item.caption ? '<div class="gallery-caption">' + escapeHtml(item.caption) + '</div>' : '') +
        (isOwner ? '<button class="gallery-delete-btn" data-id="' + item._id + '">&#128465;</button>' : '') +
      '</div>';
    }).join('');

    // Generate video thumbnails
    grid.querySelectorAll('.gallery-video-canvas').forEach(function(canvas) {
      const src = canvas.dataset.src;
      const video = document.createElement('video');
      video.src = src;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.addEventListener('loadeddata', function() {
        video.currentTime = 1;
      });
      video.addEventListener('seeked', function() {
        canvas.width  = video.videoWidth  || 300;
        canvas.height = video.videoHeight || 300;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        video.src = '';
      });
      video.load();
    });

    grid.querySelectorAll('.gallery-item').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target.classList.contains('gallery-delete-btn')) return;
        const id   = el.dataset.id;
        const item = galleryModule._items.find(function(i) { return i._id === id; });
        if (item) galleryModule._openLightbox(item);
      });
    });

    grid.querySelectorAll('.gallery-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (confirm('Delete this item?')) galleryModule._deleteItem(btn.dataset.id);
      });
    });
  },

  _openLightbox(item) {
    document.getElementById('galleryLightbox')?.remove();
    const lb = document.createElement('div');
    lb.id = 'galleryLightbox';
    lb.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;align-items:center;justify-content:center;';
    lb.innerHTML =
      '<button style="position:absolute;top:16px;right:16px;background:none;border:none;color:white;font-size:24px;cursor:pointer" id="lbClose">&#10005;</button>' +
      (item.type === 'video'
        ? '<video src="' + item.url + '" controls autoplay style="max-width:100%;max-height:80vh;border-radius:8px"></video>'
        : '<img src="' + item.url + '" style="max-width:100%;max-height:80vh;border-radius:8px;object-fit:contain" alt="">') +
      '<div style="color:white;text-align:center;padding:12px;max-width:90%">' +
        (item.caption ? '<p style="margin:4px 0">' + escapeHtml(item.caption) + '</p>' : '') +
        (item.price   ? '<p style="margin:4px 0;color:#4CAF50;font-weight:700">&#8358;' + escapeHtml(item.price) + '</p>' : '') +
      '</div>';
    document.body.appendChild(lb);
    lb.querySelector('#lbClose').addEventListener('click', function() { lb.remove(); });
    lb.addEventListener('click', function(e) { if (e.target === lb) lb.remove(); });
  },

  _showUploadDialog() {
    document.getElementById('galleryUploadDlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id        = 'galleryUploadDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:320px">' +
        '<h3 style="margin-bottom:12px">Upload to Gallery</h3>' +
        '<input type="file" id="galleryFileInput" accept="image/*,video/*" class="input" style="margin-bottom:8px"/>' +
        '<input type="text" id="galleryCaptionInput" class="input" placeholder="Caption (optional)" style="margin-bottom:8px"/>' +
        '<input type="text" id="galleryPriceInput" class="input" placeholder="Price e.g. 5000 (business only)" style="margin-bottom:8px"/>' +
        '<select id="galleryVisibilityInput" class="input" style="margin-bottom:8px">' +
          '<option value="contacts">Contacts only</option>' +
          '<option value="public">Public</option>' +
          '<option value="private">Private (only me)</option>' +
        '</select>' +
        '<select id="galleryModeInput" class="input" style="margin-bottom:12px">' +
          '<option value="personal">Personal</option>' +
          '<option value="business">Business</option>' +
        '</select>' +
        '<button class="btn primary" id="galleryUploadConfirmBtn" style="width:100%">Upload</button>' +
        '<button class="btn secondary" id="galleryUploadCancelBtn" style="width:100%;margin-top:8px">Cancel</button>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#galleryUploadCancelBtn').addEventListener('click', function() { dlg.remove(); });
    dlg.querySelector('#galleryUploadConfirmBtn').addEventListener('click', function() { galleryModule._uploadItem(dlg); });
  },

  async _uploadItem(dlg) {
    const file       = dlg.querySelector('#galleryFileInput').files[0];
    const caption    = dlg.querySelector('#galleryCaptionInput').value.trim();
    const price      = dlg.querySelector('#galleryPriceInput').value.trim();
    const visibility = dlg.querySelector('#galleryVisibilityInput').value;
    const mode       = dlg.querySelector('#galleryModeInput').value;
    if (!file) { showNotification('Please select a file'); return; }

    const btn = dlg.querySelector('#galleryUploadConfirmBtn');
    btn.textContent = 'Uploading...'; btn.disabled = true;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', USER.xameId);
    formData.append('caption', caption);
    formData.append('price', price);
    formData.append('visibility', visibility);
    formData.append('mode', mode);

    try {
      const res  = await fetch('/api/gallery/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        dlg.remove();
        showNotification('Uploaded successfully!');
        this._loadItems();
      } else {
        showNotification('Upload failed: ' + (data.message || 'Unknown error'));
        btn.textContent = 'Upload'; btn.disabled = false;
      }
    } catch (err) {
      showNotification('Upload error: ' + err.message);
      btn.textContent = 'Upload'; btn.disabled = false;
    }
  },

  async _deleteItem(itemId) {
    try {
      const res  = await fetch('/api/gallery/' + itemId, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER.xameId })
      });
      const data = await res.json();
      if (data.success) {
        this._items = this._items.filter(function(i) { return i._id !== itemId; });
        this._renderGrid();
        showNotification('Deleted');
      }
    } catch (err) {
      showNotification('Delete failed');
    }
  },
};
