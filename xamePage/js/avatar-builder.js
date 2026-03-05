
const avatarBuilder = (() => {

  const SKIN   = ['#FDDBB4','#F5C89A','#E8A87C','#C68642','#8D5524','#4A2912'];
  const HAIR   = ['#1a1a1a','#2c1b0e','#6B3A2A','#A0522D','#C19A6B','#F4C842','#E8E8E8','#FF6B6B','#7B68EE'];
  const EYES   = ['#1a1a1a','#3B2314','#4E8098','#2D6A2D','#8B6914','#7B68EE'];
  const LIPS   = ['#C46B6B','#E88080','#FF9999','#A0522D','#8B4513','#FF6B6B'];

  const HAIR_STYLES = [
    {id:'short',  label:'Short',   path:'M10,35 Q20,5 50,5 Q80,5 90,35 Q75,15 50,15 Q25,15 10,35Z'},
    {id:'medium', label:'Medium',  path:'M8,45 Q15,5 50,5 Q85,5 92,45 Q80,10 50,10 Q20,10 8,45Z M8,45 Q5,70 8,85 Q20,20 50,18 Q80,20 92,85 Q95,70 92,45Z'},
    {id:'long',   label:'Long',    path:'M8,45 Q15,5 50,5 Q85,5 92,45 Q80,10 50,10 Q20,10 8,45Z M5,45 Q2,80 5,110 Q18,25 50,20 Q82,25 95,110 Q98,80 95,45Z'},
    {id:'curly',  label:'Curly',   path:'M15,40 Q10,10 30,8 Q20,20 25,30 Q35,5 50,5 Q65,5 75,30 Q80,20 70,8 Q90,10 85,40 Q78,12 50,12 Q22,12 15,40Z'},
    {id:'bald',   label:'Bald',    path:''},
    {id:'bun',    label:'Bun',     path:'M10,35 Q20,5 50,5 Q80,5 90,35 Q75,15 50,15 Q25,15 10,35Z M42,8 Q50,-5 58,8 Q55,2 50,2 Q45,2 42,8Z'},
  ];

  const ACCESSORIES = [
    {id:'none',    label:'None',       svg:''},
    {id:'glasses', label:'Glasses',    svg:'<rect x="22" y="48" width="20" height="12" rx="4" fill="none" stroke="#333" stroke-width="2"/><rect x="58" y="48" width="20" height="12" rx="4" fill="none" stroke="#333" stroke-width="2"/><line x1="42" y1="54" x2="58" y2="54" stroke="#333" stroke-width="2"/><line x1="10" y1="52" x2="22" y2="52" stroke="#333" stroke-width="2"/><line x1="78" y1="52" x2="90" y2="52" stroke="#333" stroke-width="2"/>'},
    {id:'sunglasses',label:'Sunnies',  svg:'<rect x="20" y="47" width="24" height="13" rx="4" fill="#222" opacity="0.85"/><rect x="56" y="47" width="24" height="13" rx="4" fill="#222" opacity="0.85"/><line x1="44" y1="53" x2="56" y2="53" stroke="#555" stroke-width="2"/><line x1="8" y1="51" x2="20" y2="51" stroke="#555" stroke-width="2"/><line x1="80" y1="51" x2="92" y2="51" stroke="#555" stroke-width="2"/>'},
    {id:'hat',     label:'Hat',        svg:'<rect x="15" y="18" width="70" height="8" rx="4" fill="#333"/><rect x="28" y="4" width="44" height="18" rx="6" fill="#333"/>'},
    {id:'earrings',label:'Earrings',   svg:'<circle cx="12" cy="65" r="4" fill="#FFD700"/><circle cx="88" cy="65" r="4" fill="#FFD700"/>'},
    {id:'headband',label:'Headband',   svg:'<path d="M12,38 Q50,28 88,38" fill="none" stroke="#FF6B6B" stroke-width="6" stroke-linecap="round"/>'},
  ];

  let state = {
    skin: SKIN[0], hairColor: HAIR[0], hairStyle: 'short',
    eyeColor: EYES[0], lipColor: LIPS[0], accessory: 'none',
    bgColor: '#1a3a4a'
  };

  const BG_COLORS = ['#1a3a4a','#2d1b4e','#1a4a2d','#4a1a1a','#1a2a4a','#3a3a1a','#4a2d1a','#1a4a4a'];

  function buildSVG(s) {
    const hair = HAIR_STYLES.find(h => h.id === s.hairStyle) || HAIR_STYLES[0];
    const acc  = ACCESSORIES.find(a => a.id === s.accessory) || ACCESSORIES[0];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
      <circle cx="50" cy="50" r="50" fill="${s.bgColor}"/>
      ${hair.path ? `<path d="${hair.path}" fill="${s.hairColor}"/>` : ''}
      <ellipse cx="50" cy="58" rx="28" ry="32" fill="${s.skin}"/>
      <ellipse cx="50" cy="45" rx="26" ry="28" fill="${s.skin}"/>
      <circle cx="36" cy="48" r="7" fill="white"/>
      <circle cx="64" cy="48" r="7" fill="white"/>
      <circle cx="37" cy="49" r="4" fill="${s.eyeColor}"/>
      <circle cx="65" cy="49" r="4" fill="${s.eyeColor}"/>
      <circle cx="38" cy="48" r="1.5" fill="white"/>
      <circle cx="66" cy="48" r="1.5" fill="white"/>
      <path d="M38,58 Q50,65 62,58 Q56,68 44,68Z" fill="${s.lipColor}"/>
      <path d="M38,58 Q50,62 62,58" fill="none" stroke="${s.lipColor}" stroke-width="1.5"/>
      <ellipse cx="28" cy="60" rx="6" ry="4" fill="${s.skin}" opacity="0.6"/>
      <ellipse cx="72" cy="60" rx="6" ry="4" fill="${s.skin}" opacity="0.6"/>
      <ellipse cx="28" cy="60" rx="4" ry="2.5" fill="#E88080" opacity="0.3"/>
      <ellipse cx="72" cy="60" rx="4" ry="2.5" fill="#E88080" opacity="0.3"/>
      <path d="M32,37 Q34,33 38,35" fill="none" stroke="${s.hairColor}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M62,35 Q66,33 68,37" fill="none" stroke="${s.hairColor}" stroke-width="1.5" stroke-linecap="round"/>
      ${acc.svg}
    </svg>`;
  }

  function svgToDataURL(svgStr) {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
  }

  function swatchRow(label, colors, key, isStyle=false, items=null) {
    if (isStyle && items) {
      return `<div style="margin-bottom:16px;">
        <div style="font-size:12px;color:#7a9bb5;margin-bottom:8px;font-weight:600;">${label}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${items.map(item => `<button class="av-style-btn" data-key="${key}" data-val="${item.id}"
            style="padding:6px 12px;border-radius:20px;border:2px solid ${state[key]===item.id?'#00B0A0':'rgba(255,255,255,0.1)'};
            background:${state[key]===item.id?'rgba(0,176,160,0.15)':'var(--bg-primary,#0d1520)'};
            color:#fff;font-size:12px;cursor:pointer;">${item.label}</button>`).join('')}
        </div>
      </div>`;
    }
    return `<div style="margin-bottom:16px;">
      <div style="font-size:12px;color:#7a9bb5;margin-bottom:8px;font-weight:600;">${label}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${colors.map(c => `<button class="av-color-btn" data-key="${key}" data-val="${c}"
          style="width:28px;height:28px;border-radius:50%;background:${c};border:3px solid ${state[key]===c?'#00B0A0':'transparent'};cursor:pointer;"></button>`).join('')}
      </div>
    </div>`;
  }

  function render(dlg) {
    const preview = dlg.querySelector('#avPreview');
    if (preview) preview.innerHTML = buildSVG(state);
    dlg.querySelectorAll('.av-color-btn').forEach(b => {
      b.style.borderColor = state[b.dataset.key] === b.dataset.val ? '#00B0A0' : 'transparent';
    });
    dlg.querySelectorAll('.av-style-btn').forEach(b => {
      const active = state[b.dataset.key] === b.dataset.val;
      b.style.borderColor = active ? '#00B0A0' : 'rgba(255,255,255,0.1)';
      b.style.background  = active ? 'rgba(0,176,160,0.15)' : 'var(--bg-primary,#0d1520)';
    });
  }

  function show() {
    document.getElementById('avatarBuilderDlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'avatarBuilderDlg';
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';

    dlg.innerHTML = `<div style="background:var(--bg-secondary,#111e2e);border-radius:20px 20px 0 0;width:100%;max-width:500px;max-height:90vh;overflow-y:auto;padding:20px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 style="font-size:17px;font-weight:700;color:#fff;">&#127912; Avatar Builder</h3>
        <button id="avClose" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">&#10005;</button>
      </div>
      <div style="display:flex;justify-content:center;margin-bottom:24px;">
        <div id="avPreview" style="width:100px;height:100px;border-radius:50%;overflow:hidden;border:3px solid #00B0A0;"></div>
      </div>
      ${swatchRow('Skin Tone', SKIN, 'skin')}
      ${swatchRow('Hair Style', [], 'hairStyle', true, HAIR_STYLES)}
      ${swatchRow('Hair Color', HAIR, 'hairColor')}
      ${swatchRow('Eye Color', EYES, 'eyeColor')}
      ${swatchRow('Lip Color', LIPS, 'lipColor')}
      ${swatchRow('Accessory', [], 'accessory', true, ACCESSORIES)}
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;color:#7a9bb5;margin-bottom:8px;font-weight:600;">Background</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${BG_COLORS.map(c => `<button class="av-color-btn" data-key="bgColor" data-val="${c}"
            style="width:28px;height:28px;border-radius:50%;background:${c};border:3px solid ${state.bgColor===c?'#00B0A0':'transparent'};cursor:pointer;"></button>`).join('')}
        </div>
      </div>
      <div style="display:flex;gap:10px;">
        <button id="avRandom" style="flex:1;padding:14px;border-radius:12px;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">&#127922; Random</button>
        <button id="avSave" style="flex:2;padding:14px;border-radius:12px;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">&#10003; Use Avatar</button>
      </div>
    </div>`;

    document.body.appendChild(dlg);
    render(dlg);

    dlg.querySelector('#avClose').addEventListener('click', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

    dlg.querySelectorAll('.av-color-btn, .av-style-btn').forEach(b => {
      b.addEventListener('click', () => {
        state[b.dataset.key] = b.dataset.val;
        render(dlg);
      });
    });

    dlg.querySelector('#avRandom').addEventListener('click', () => {
      state.skin      = SKIN[Math.floor(Math.random()*SKIN.length)];
      state.hairColor = HAIR[Math.floor(Math.random()*HAIR.length)];
      state.hairStyle = HAIR_STYLES[Math.floor(Math.random()*HAIR_STYLES.length)].id;
      state.eyeColor  = EYES[Math.floor(Math.random()*EYES.length)];
      state.lipColor  = LIPS[Math.floor(Math.random()*LIPS.length)];
      state.accessory = ACCESSORIES[Math.floor(Math.random()*ACCESSORIES.length)].id;
      state.bgColor   = BG_COLORS[Math.floor(Math.random()*BG_COLORS.length)];
      render(dlg);
    });

    dlg.querySelector('#avSave').addEventListener('click', () => {
      const svgStr  = buildSVG(state);
      const dataURL = svgToDataURL(svgStr);

      // Convert SVG to PNG blob then upload as profile pic
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 200, 200);
        canvas.toBlob(async blob => {
          if (!blob) { showNotification('Failed to generate avatar'); return; }
          const formData = new FormData();
          formData.append('profilePic', blob, 'avatar.png');
          formData.append('xameId', USER.xameId);
          try {
            const res = await fetch(serverURL + '/api/update-profile', { method:'POST', body:formData });
            const data = await res.json();
            if (data.success) {
              USER.profilePic = data.profilePicUrl || dataURL;
              storage.set(KEYS.user, USER);
              const preview = document.getElementById('profilePicPreview');
              if (preview) preview.src = dataURL;
              // Update all avatars in UI
              document.querySelectorAll('.chat-header .profile-pic, #chatHeaderPic').forEach(el => {
                if (el.dataset.xameId === USER.xameId) el.src = dataURL;
              });
              showNotification('Avatar saved!');
              dlg.remove();
            } else {
              // Fallback: save locally
              USER.profilePic = dataURL;
              storage.set(KEYS.user, USER);
              const preview = document.getElementById('profilePicPreview');
              if (preview) preview.src = dataURL;
              showNotification('Avatar applied!');
              dlg.remove();
            }
          } catch(e) {
            USER.profilePic = dataURL;
            storage.set(KEYS.user, USER);
            const preview = document.getElementById('profilePicPreview');
            if (preview) preview.src = dataURL;
            showNotification('Avatar applied locally!');
            dlg.remove();
          }
        }, 'image/png');
      };
      img.src = dataURL;
    });
  }

  // Attach to button
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('buildAvatarBtn')?.addEventListener('click', show);
  });
  // Also attach immediately in case DOM already loaded
  document.getElementById('buildAvatarBtn')?.addEventListener('click', show);

  return { show };
})();
