/*
 * chat-lock.js — XamePage v2.1.1
 * Lock individual chats with a PIN
 */

const chatLockModule = (() => {

  const LOCKS_KEY = "xame:chat-locks";
  const UNLOCKED_KEY = "xame:chat-unlocked";

  function getLocks() { return persistentStorage.get(LOCKS_KEY) || {}; }
  function saveLocks(l) { persistentStorage.set(LOCKS_KEY, l); }
  function getUnlocked() {
    try { return JSON.parse(sessionStorage.getItem(UNLOCKED_KEY) || "[]"); }
    catch(e) { return []; }
  }
  function setUnlocked(arr) { sessionStorage.setItem(UNLOCKED_KEY, JSON.stringify(arr)); }

  function isLocked(chatId) { return !!getLocks()[chatId]; }
  function isUnlocked(chatId) { return getUnlocked().includes(chatId); }

  function lockChat(chatId) {
    const arr = getUnlocked().filter(x => x !== chatId);
    setUnlocked(arr);
  }

  // Returns true if chat can proceed, false if blocked
  function checkLock(chatId, onUnlocked) {
    if (!isLocked(chatId)) { onUnlocked(); return; }
    if (isUnlocked(chatId)) { onUnlocked(); return; }
    showPinPrompt(chatId, onUnlocked);
  }

  function showPinPrompt(chatId, onUnlocked) {
    document.getElementById("chatLockPrompt")?.remove();
    const dlg = document.createElement("div");
    dlg.id = "chatLockPrompt";
    dlg.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;";
    dlg.innerHTML = `<div style="background:var(--bg-secondary,#111e2e);border-radius:20px;padding:32px 24px;width:90%;max-width:320px;text-align:center;">
      <div style="font-size:48px;margin-bottom:16px;">&#128274;</div>
      <h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">Chat Locked</h3>
      <p style="font-size:13px;color:#7a9bb5;margin-bottom:24px;">Enter your PIN to unlock</p>
      <div id="pinDots" style="display:flex;justify-content:center;gap:12px;margin-bottom:24px;">
        ${[0,1,2,3].map(()=>'<div style="width:14px;height:14px;border-radius:50%;border:2px solid #7a9bb5;background:transparent;transition:background 0.15s;"></div>').join("")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
        ${[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(k => `<button class="pin-key" data-key="${k}" style="padding:16px;border-radius:12px;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.08);color:#fff;font-size:20px;font-weight:600;cursor:pointer;">${k}</button>`).join("")}
      </div>
      <div id="pinError" style="color:#ff6464;font-size:13px;height:18px;"></div>
      <button id="pinCancelBtn" style="margin-top:12px;background:none;border:none;color:#7a9bb5;font-size:14px;cursor:pointer;">Cancel</button>
    </div>`;
    document.body.appendChild(dlg);

    let entered = "";
    const dots = dlg.querySelectorAll("#pinDots div");

    function updateDots() {
      dots.forEach((d,i) => {
        d.style.background = i < entered.length ? "#00B0A0" : "transparent";
        d.style.borderColor = i < entered.length ? "#00B0A0" : "#7a9bb5";
      });
    }

    function tryPin() {
      const locks = getLocks();
      if (locks[chatId] === entered) {
        const arr = getUnlocked();
        arr.push(chatId);
        setUnlocked(arr);
        dlg.remove();
        onUnlocked();
      } else {
        dlg.querySelector("#pinError").textContent = "Incorrect PIN. Try again.";
        entered = "";
        updateDots();
        setTimeout(() => { dlg.querySelector("#pinError").textContent = ""; }, 1500);
      }
    }

    dlg.querySelectorAll(".pin-key").forEach(b => {
      b.addEventListener("click", () => {
        const k = b.dataset.key;
        if (k === "⌫") { entered = entered.slice(0,-1); updateDots(); }
        else if (k === "") return;
        else if (entered.length < 4) {
          entered += k;
          updateDots();
          if (entered.length === 4) setTimeout(tryPin, 150);
        }
      });
    });

    dlg.querySelector("#pinCancelBtn").addEventListener("click", () => {
      dlg.remove();
      // Go back to contacts
      if (typeof show === "function" && typeof elContacts !== "undefined") show(elContacts);
    });
  }

  function showSetPinDialog(chatId, contactName) {
    document.getElementById("chatSetPinDlg")?.remove();
    const locks = getLocks();
    const hasPin = !!locks[chatId];

    const dlg = document.createElement("div");
    dlg.id = "chatSetPinDlg";
    dlg.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:flex-end;justify-content:center;";
    dlg.innerHTML = `<div style="background:var(--bg-secondary,#111e2e);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:700;color:#fff;">&#128274; Chat Lock</h3>
        <button id="spClose" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">&#10005;</button>
      </div>
      <p style="font-size:13px;color:#7a9bb5;margin-bottom:20px;">${hasPin ? "Chat with <b style=color:#fff>" + contactName + "</b> is locked." : "Lock chat with <b style=color:#fff>" + contactName + "</b> using a 4-digit PIN."}</p>
      ${hasPin ? `
        <button id="spRemove" style="width:100%;padding:14px;border-radius:12px;background:rgba(255,100,100,0.1);border:1px solid rgba(255,100,100,0.3);color:#ff6464;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">&#128275; Remove Lock</button>
        <button id="spChange" style="width:100%;padding:14px;border-radius:12px;background:rgba(0,176,160,0.1);border:1px solid rgba(0,176,160,0.3);color:#00B0A0;font-size:15px;font-weight:600;cursor:pointer;">&#128273; Change PIN</button>
      ` : `
        <div id="spStep1">
          <p style="font-size:12px;color:#7a9bb5;margin-bottom:12px;text-align:center;">Enter new PIN</p>
          <div id="spDots1" style="display:flex;justify-content:center;gap:12px;margin-bottom:20px;">
            ${[0,1,2,3].map(()=>'<div style="width:14px;height:14px;border-radius:50%;border:2px solid #7a9bb5;background:transparent;transition:background 0.15s;"></div>').join("")}
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
            ${[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(k=>`<button class="sp-key" data-key="${k}" style="padding:16px;border-radius:12px;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.08);color:#fff;font-size:20px;font-weight:600;cursor:pointer;">${k}</button>`).join("")}
          </div>
        </div>
        <div id="spStep2" style="display:none;">
          <p style="font-size:12px;color:#7a9bb5;margin-bottom:12px;text-align:center;">Confirm PIN</p>
          <div id="spDots2" style="display:flex;justify-content:center;gap:12px;margin-bottom:20px;">
            ${[0,1,2,3].map(()=>'<div style="width:14px;height:14px;border-radius:50%;border:2px solid #7a9bb5;background:transparent;transition:background 0.15s;"></div>').join("")}
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
            ${[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(k=>`<button class="sp-key2" data-key="${k}" style="padding:16px;border-radius:12px;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.08);color:#fff;font-size:20px;font-weight:600;cursor:pointer;">${k}</button>`).join("")}
          </div>
          <div id="spError" style="color:#ff6464;font-size:13px;text-align:center;margin-top:10px;height:18px;"></div>
        </div>
      `}
    </div>`;

    document.body.appendChild(dlg);
    dlg.querySelector("#spClose").addEventListener("click", () => dlg.remove());
    dlg.addEventListener("click", e => { if(e.target===dlg) dlg.remove(); });

    if (hasPin) {
      dlg.querySelector("#spRemove")?.addEventListener("click", () => {
        const l = getLocks(); delete l[chatId]; saveLocks(l);
        lockChat(chatId);
        showNotification("Chat lock removed");
        dlg.remove();
      });
      dlg.querySelector("#spChange")?.addEventListener("click", () => {
        const l = getLocks(); delete l[chatId]; saveLocks(l);
        dlg.remove();
        showSetPinDialog(chatId, contactName);
      });
      return;
    }

    let pin1 = "", pin2 = "";

    function updateDots(dotsEl, val) {
      dotsEl.querySelectorAll("div").forEach((d,i) => {
        d.style.background = i < val.length ? "#00B0A0" : "transparent";
        d.style.borderColor = i < val.length ? "#00B0A0" : "#7a9bb5";
      });
    }

    dlg.querySelectorAll(".sp-key").forEach(b => {
      b.addEventListener("click", () => {
        const k = b.dataset.key;
        if (k === "⌫") { pin1 = pin1.slice(0,-1); }
        else if (k === "" || pin1.length >= 4) return;
        else pin1 += k;
        updateDots(dlg.querySelector("#spDots1"), pin1);
        if (pin1.length === 4) {
          setTimeout(() => {
            dlg.querySelector("#spStep1").style.display = "none";
            dlg.querySelector("#spStep2").style.display = "block";
          }, 150);
        }
      });
    });

    dlg.querySelectorAll(".sp-key2").forEach(b => {
      b.addEventListener("click", () => {
        const k = b.dataset.key;
        if (k === "⌫") { pin2 = pin2.slice(0,-1); }
        else if (k === "" || pin2.length >= 4) return;
        else pin2 += k;
        updateDots(dlg.querySelector("#spDots2"), pin2);
        if (pin2.length === 4) {
          setTimeout(() => {
            if (pin1 === pin2) {
              const l = getLocks(); l[chatId] = pin1; saveLocks(l);
              showNotification("&#128274; Chat locked!");
              dlg.remove();
            } else {
              dlg.querySelector("#spError").textContent = "PINs do not match. Try again.";
              pin2 = "";
              updateDots(dlg.querySelector("#spDots2"), pin2);
              setTimeout(() => { pin1=""; pin2=""; dlg.querySelector("#spError").textContent=""; dlg.querySelector("#spStep2").style.display="none"; dlg.querySelector("#spStep1").style.display="block"; updateDots(dlg.querySelector("#spDots1"), pin1); }, 1500);
            }
          }, 150);
        }
      });
    });
  }

  return { checkLock, isLocked, isUnlocked, lockChat, showSetPinDialog };
})();
