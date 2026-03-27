const translationModule = (() => {

  const LANGUAGES = [
    {code:"en",name:"English"},{code:"es",name:"Spanish"},{code:"fr",name:"French"},
    {code:"ar",name:"Arabic"},{code:"zh",name:"Chinese"},{code:"hi",name:"Hindi"},
    {code:"pt",name:"Portuguese"},{code:"ru",name:"Russian"},{code:"de",name:"German"},
    {code:"ja",name:"Japanese"},{code:"ko",name:"Korean"},{code:"it",name:"Italian"},
    {code:"tr",name:"Turkish"},{code:"nl",name:"Dutch"},{code:"pl",name:"Polish"},
    {code:"sv",name:"Swedish"},{code:"da",name:"Danish"},{code:"fi",name:"Finnish"},
    {code:"he",name:"Hebrew"},{code:"id",name:"Indonesian"},{code:"ms",name:"Malay"},
    {code:"th",name:"Thai"},{code:"vi",name:"Vietnamese"},{code:"uk",name:"Ukrainian"},
    {code:"ro",name:"Romanian"},{code:"hu",name:"Hungarian"},{code:"cs",name:"Czech"},
    {code:"el",name:"Greek"},{code:"bn",name:"Bengali"},{code:"fa",name:"Persian"},
    {code:"ur",name:"Urdu"},{code:"sw",name:"Swahili"},{code:"yo",name:"Yoruba"},
    {code:"ig",name:"Igbo"},{code:"ha",name:"Hausa"},{code:"am",name:"Amharic"},
    {code:"so",name:"Somali"},{code:"zu",name:"Zulu"},{code:"af",name:"Afrikaans"},
    {code:"bg",name:"Bulgarian"},{code:"ca",name:"Catalan"},{code:"hr",name:"Croatian"},
    {code:"et",name:"Estonian"},{code:"ka",name:"Georgian"},{code:"gu",name:"Gujarati"},
    {code:"is",name:"Icelandic"},{code:"kn",name:"Kannada"},{code:"kk",name:"Kazakh"},
    {code:"km",name:"Khmer"},{code:"lo",name:"Lao"},{code:"lv",name:"Latvian"},
    {code:"lt",name:"Lithuanian"},{code:"mk",name:"Macedonian"},{code:"ml",name:"Malayalam"},
    {code:"mt",name:"Maltese"},{code:"mr",name:"Marathi"},{code:"mn",name:"Mongolian"},
    {code:"my",name:"Myanmar"},{code:"ne",name:"Nepali"},{code:"ps",name:"Pashto"},
    {code:"pa",name:"Punjabi"},{code:"sr",name:"Serbian"},{code:"si",name:"Sinhala"},
    {code:"sk",name:"Slovak"},{code:"sl",name:"Slovenian"},{code:"tl",name:"Filipino"},
    {code:"ta",name:"Tamil"},{code:"te",name:"Telugu"},{code:"uz",name:"Uzbek"},
    {code:"cy",name:"Welsh"},{code:"no",name:"Norwegian"},{code:"sq",name:"Albanian"},
  ];

  let _preferredLang = persistentStorage.get("xame:translateLang") || "en";

  async function translate(text, targetLang) {
    try {
      const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=en|" + targetLang;
      const res = await fetch(url);
      const data = await res.json();
      if (data.responseStatus === 200) return { success:true, text:data.responseData.translatedText };
      return { success:false, error:data.responseDetails || "Translation failed" };
    } catch(e) {
      return { success:false, error:"Network error" };
    }
  }

  function showTranslateDialog(messageText, bubbleEl) {
    document.getElementById("xame-translate-dlg")?.remove();
    const dlg = document.createElement("div");
    dlg.id = "xame-translate-dlg";
    dlg.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;";
    dlg.innerHTML = "<div style=\"background:var(--bg-secondary,#111e2e);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:20px;max-height:80vh;display:flex;flex-direction:column;\">"
      + "<div style=\"display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;\"><h3 style=\"font-size:16px;font-weight:700;color:#fff;\">&#127758; Translate Message</h3><button id=\"xTrClose\" style=\"background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;\">&#10005;</button></div>"
      + "<div style=\"background:var(--bg-primary,#0d1520);border-radius:12px;padding:14px;margin-bottom:16px;font-size:14px;color:#ccc;line-height:1.5;max-height:100px;overflow-y:auto;\">" + messageText + "</div>"
      + "<div style=\"margin-bottom:16px;\"><label style=\"font-size:12px;color:#7a9bb5;margin-bottom:8px;display:block;\">Translate to:</label>"
      + "<input id=\"xTrSearch\" type=\"text\" placeholder=\"Search language...\" style=\"width:100%;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 14px;color:#fff;font-size:14px;outline:none;margin-bottom:8px;\">"
      + "<select id=\"xTrLang\" size=\"5\" style=\"width:100%;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:8px;color:#fff;font-size:14px;outline:none;\">"
      + LANGUAGES.map(l => "<option value=\"" + l.code + "\"" + (l.code === _preferredLang ? " selected" : "") + ">" + l.name + "</option>").join("")
      + "</select></div>"
      + "<div id=\"xTrResult\" style=\"display:none;background:rgba(0,176,160,0.1);border:1px solid rgba(0,176,160,0.3);border-radius:12px;padding:14px;margin-bottom:16px;font-size:14px;color:#fff;line-height:1.5;\"></div>"
      + "<button id=\"xTrBtn\" style=\"width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:12px;padding:14px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;\">Translate</button>"
      + "</div>";
    document.body.appendChild(dlg);

    dlg.querySelector("#xTrSearch").addEventListener("input", function() {
      const q = this.value.toLowerCase();
      dlg.querySelector("#xTrLang").innerHTML = LANGUAGES
        .filter(l => l.name.toLowerCase().includes(q) || l.code.includes(q))
        .map(l => "<option value=\"" + l.code + "\"" + (l.code === _preferredLang ? " selected" : "") + ">" + l.name + "</option>").join("");
    });

    dlg.querySelector("#xTrClose").addEventListener("click", () => dlg.remove());
    dlg.addEventListener("click", e => { if(e.target === dlg) dlg.remove(); });

    dlg.querySelector("#xTrBtn").addEventListener("click", async () => {
      const lang = dlg.querySelector("#xTrLang").value;
      if(!lang) { showNotification("Select a language"); return; }
      _preferredLang = lang;
      persistentStorage.set("xame:translateLang", lang);
      const btn = dlg.querySelector("#xTrBtn");
      btn.textContent = "Translating...";
      btn.disabled = true;
      const result = await translate(messageText, lang);
      btn.textContent = "Translate";
      btn.disabled = false;
      const resultEl = dlg.querySelector("#xTrResult");
      resultEl.style.display = "block";
      if(result.success) {
        const langName = LANGUAGES.find(l => l.code === lang)?.name || lang;
        resultEl.innerHTML = "<div style=\"font-size:11px;color:#00B0A0;font-weight:700;margin-bottom:6px;\">&#127758; " + langName + "</div><div>" + result.text + "</div><button id=\"xTrCopy\" style=\"margin-top:10px;background:rgba(0,176,160,0.15);border:1px solid rgba(0,176,160,0.3);border-radius:8px;padding:6px 14px;color:#00B0A0;font-size:12px;font-weight:600;cursor:pointer;\">&#10697; Copy</button>";
        resultEl.querySelector("#xTrCopy").addEventListener("click", () => {
          const text = result.text;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => showNotification("Translation copied!")).catch(() => {
              const ta = document.createElement("textarea");
              ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
              document.body.appendChild(ta); ta.focus(); ta.select();
              document.execCommand("copy"); document.body.removeChild(ta);
              showNotification("Translation copied!");
            });
          } else {
            const ta = document.createElement("textarea");
            ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.focus(); ta.select();
            document.execCommand("copy"); document.body.removeChild(ta);
            showNotification("Translation copied!");
          }
        });
        showTranslationBubble(bubbleEl, result.text, langName);
      } else {
        resultEl.innerHTML = "<div style=\"color:#ff6464;\">&#10060; " + result.error + "</div>";
      }
    });
  }

  function showTranslationBubble(bubbleEl, translatedText, langName) {
    if(!bubbleEl) return;
    bubbleEl.querySelector(".translation-bubble")?.remove();
    const tb = document.createElement("div");
    tb.className = "translation-bubble";
    tb.style.cssText = "margin-top:6px;background:rgba(0,176,160,0.1);border:1px solid rgba(0,176,160,0.25);border-radius:10px;padding:8px 12px;font-size:13px;color:#ccc;line-height:1.5;";
    tb.innerHTML = "<div style=\"font-size:10px;color:#00B0A0;font-weight:700;margin-bottom:4px;\">&#127758; " + langName + "</div>" + translatedText + "<button class=\"tr-dismiss\" style=\"display:block;margin-top:6px;background:none;border:none;color:#7a9bb5;font-size:11px;cursor:pointer;\">&#10005; Dismiss</button>";
    bubbleEl.appendChild(tb);
    tb.querySelector(".tr-dismiss").addEventListener("click", () => tb.remove());
  }

  function injectIntoContextMenu(menuEl, bubbleEl, messageText) {
    if(!menuEl || !messageText) return;
    if(menuEl.querySelector(".ctx-translate")) return;
    const btn = document.createElement("button");
    btn.className = "ctx-translate context-menu-item";
    btn.innerHTML = "&#127758; Translate";
    btn.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:12px 16px;background:none;border:none;color:#fff;font-size:14px;cursor:pointer;text-align:left;";
    btn.addEventListener("click", () => { menuEl.remove(); showTranslateDialog(messageText, bubbleEl); });
    menuEl.appendChild(btn);
  }

  const style = document.createElement("style");
  style.textContent = ".translation-bubble{animation:fadeInUp 0.2s ease} @keyframes fadeInUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}";
  document.head.appendChild(style);

  return { showTranslateDialog, injectIntoContextMenu, LANGUAGES };
})();
