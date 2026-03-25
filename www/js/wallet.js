const walletModule = (() => {
  const WALLET_CONFIG = {
    testMode: false,
    flutterwave: { publicKey: '', secretKey: '' },
    paystack:    { publicKey: persistentStorage.get('wallet:psk:publicKey') || '', secretKey: persistentStorage.get('wallet:psk:secretKey') || '' },
    currency: persistentStorage.get('wallet:currency') || 'NGN',
    defaultProvider: persistentStorage.get('wallet:provider') || 'flutterwave',
  };
  let _balance = 0;
  let _transactions = [];
  let _walletLoaded = false;

  async function loadWallet() {
    if (!USER?.xameId) return;
    try {
      const r = await fetch(serverURL+'/api/wallet/me?userId=' + USER.xameId);
      const data = await r.json();
      if (data.success) {
        _balance = data.balance;
        _transactions = (data.transactions || []).map(t => ({...t, ts: t.ts || new Date().toISOString()}));
        const savedCurrency = persistentStorage.get('wallet:currency');
        if (savedCurrency) WALLET_CONFIG.currency = savedCurrency;
        else if (data.currency) WALLET_CONFIG.currency = data.currency;
        _walletLoaded = true;
        // Refresh UI if open
        if (document.getElementById('walletOverlay')) renderS('home');
      }
    } catch(e) { console.warn('Wallet load failed:', e); }
  }
  const SYM = {NGN:'\u20a6',GHS:'GH\u20b5',KES:'KSh',ZAR:'R',USD:'$',EUR:'\u20ac',GBP:'\u00a3',INR:'\u20b9',BRL:'R$',AED:'AED',CAD:'CA$',AUD:'A$',ZMW:'ZK',TZS:'TSh',UGX:'USh',XOF:'CFA',JPY:'\u00a5',SGD:'S$',EGP:'E\u00a3',MAD:'MAD',ETB:'Br',RWF:'Fr',GNF:'FCFA',ZWL:'Z$',MXN:'MX$',COP:'COL$',ARS:'AR$',PKR:'\u20a8',BDT:'\u09f3',PHP:'\u20b1',IDR:'Rp',MYR:'RM',THB:'\u0e3f',VND:'\u20ab',SAR:'SAR',QAR:'QR',TRY:'\u20ba'};
  function fmt(n){return (SYM[WALLET_CONFIG.currency]||WALLET_CONFIG.currency+' ')+Number(n).toLocaleString('en',{minimumFractionDigits:2});}
  function updateBalance(n){ _balance = Math.max(0, Math.round((_balance + n) * 100) / 100); }
  function addTx(tx){ _transactions.unshift({...tx, id:Date.now().toString(), ts:new Date().toISOString()}); if(_transactions.length>100) _transactions=_transactions.slice(0,100); }
  let _serverConfigured = false;
  function isConfigured(){ return _serverConfigured; }
  // Pre-load everything on module init (eager loading)
  function _init() {
    fetch(serverURL+'/api/wallet/pubkey').then(r=>r.json()).then(d=>{
    _serverConfigured = d.configured || false;
    // Only use server currency if user hasn't set a preference
    if(d.currency && !persistentStorage.get('wallet:currency')) WALLET_CONFIG.currency = d.currency;
    if(d.provider) WALLET_CONFIG.defaultProvider = d.provider;
    loadWallet();
  }).catch(()=>{ loadWallet(); });
  }
  const GD = {
    NGN:{country:'Nigeria',networks:[{id:'MTN-NG',label:'MTN',icon:'\u{1F7E1}'},{id:'AIRTEL-NG',label:'Airtel',icon:'\u{1F534}'},{id:'GLO-NG',label:'Glo',icon:'\u{1F7E2}'},{id:'9MOBILE-NG',label:'9mobile',icon:'\u{1F49A}'}],dataPlans:{'MTN-NG':[{size:'500MB',days:30,price:300},{size:'1GB',days:30,price:500},{size:'2GB',days:30,price:1000},{size:'5GB',days:30,price:2000},{size:'10GB',days:30,price:3500}],'AIRTEL-NG':[{size:'500MB',days:30,price:300},{size:'1GB',days:30,price:500},{size:'2GB',days:30,price:1000},{size:'5GB',days:30,price:2000}],'GLO-NG':[{size:'1GB',days:30,price:500},{size:'2GB',days:30,price:1000},{size:'5GB',days:30,price:2000}],'9MOBILE-NG':[{size:'1GB',days:30,price:500},{size:'2GB',days:30,price:1000},{size:'5GB',days:30,price:2500}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['IKEDC','EKEDC','AEDC','PHEDC','IBEDC','BEDC','KEDCO','EEDC']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['DSTV','GOtv','Startimes']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['Lagos Water','Abuja Water']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Spectranet','Smile','ipNX','Swift']}],banks:['Access Bank','GTBank','Zenith Bank','First Bank','UBA','Fidelity Bank','Sterling Bank','Wema Bank']},
    GHS:{country:'Ghana',networks:[{id:'MTN-GH',label:'MTN',icon:'\u{1F7E1}'},{id:'VODAFONE-GH',label:'Vodafone',icon:'\u{1F534}'},{id:'AIRTELTIGO-GH',label:'AirtelTigo',icon:'\u{1F7E0}'}],dataPlans:{'MTN-GH':[{size:'1GB',days:30,price:10},{size:'2GB',days:30,price:18},{size:'5GB',days:30,price:40}],'VODAFONE-GH':[{size:'1GB',days:30,price:10},{size:'2GB',days:30,price:18},{size:'5GB',days:30,price:38}],'AIRTELTIGO-GH':[{size:'1GB',days:30,price:9},{size:'2GB',days:30,price:16},{size:'5GB',days:30,price:36}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['ECG','NEDCo']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['GWCL']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['DSTV','GOtv','Startimes']}],banks:['GCB Bank','Ecobank Ghana','Absa Ghana','Stanbic Ghana','Fidelity Bank Ghana','Cal Bank']},
    KES:{country:'Kenya',networks:[{id:'SAFARICOM-KE',label:'Safaricom',icon:'\u{1F7E2}'},{id:'AIRTEL-KE',label:'Airtel',icon:'\u{1F534}'},{id:'TELKOM-KE',label:'Telkom',icon:'\u{1F535}'}],dataPlans:{'SAFARICOM-KE':[{size:'1GB',days:30,price:99},{size:'2GB',days:30,price:149},{size:'5GB',days:30,price:349}],'AIRTEL-KE':[{size:'1GB',days:30,price:89},{size:'2GB',days:30,price:139},{size:'5GB',days:30,price:299}],'TELKOM-KE':[{size:'1GB',days:30,price:85},{size:'2GB',days:30,price:130},{size:'5GB',days:30,price:280}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['Kenya Power']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['Nairobi Water','Mombasa Water']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['DSTV','GOtv','Startimes','Zuku']}],banks:['Equity Bank','KCB Bank','Co-operative Bank','Absa Kenya','NCBA Bank','DTB Bank']},
    ZAR:{country:'South Africa',networks:[{id:'VODACOM-ZA',label:'Vodacom',icon:'\u{1F534}'},{id:'MTN-ZA',label:'MTN',icon:'\u{1F7E1}'},{id:'CELL-ZA',label:'Cell C',icon:'\u26AB'},{id:'TELKOM-ZA',label:'Telkom',icon:'\u{1F535}'}],dataPlans:{'VODACOM-ZA':[{size:'1GB',days:30,price:99},{size:'2GB',days:30,price:169},{size:'5GB',days:30,price:349}],'MTN-ZA':[{size:'1GB',days:30,price:89},{size:'2GB',days:30,price:149},{size:'5GB',days:30,price:299}],'CELL-ZA':[{size:'1GB',days:30,price:79},{size:'2GB',days:30,price:139},{size:'5GB',days:30,price:269}],'TELKOM-ZA':[{size:'1GB',days:30,price:69},{size:'2GB',days:30,price:129},{size:'5GB',days:30,price:249}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['Eskom','City Power','Cape Town Electricity']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['Johannesburg Water','Cape Town Water']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['DSTV','GOtv']}],banks:['Standard Bank','Absa','FNB','Nedbank','Capitec','Discovery Bank']},
    USD:{country:'United States',networks:[{id:'ATT-US',label:'AT&T',icon:'\u{1F535}'},{id:'TMOBILE-US',label:'T-Mobile',icon:'\u{1FA77}'},{id:'VERIZON-US',label:'Verizon',icon:'\u{1F534}'},{id:'CRICKET-US',label:'Cricket',icon:'\u{1F7E2}'}],dataPlans:{'ATT-US':[{size:'5GB',days:30,price:35},{size:'15GB',days:30,price:50},{size:'Unlimited',days:30,price:65}],'TMOBILE-US':[{size:'5GB',days:30,price:30},{size:'15GB',days:30,price:45},{size:'Unlimited',days:30,price:60}],'VERIZON-US':[{size:'5GB',days:30,price:40},{size:'15GB',days:30,price:55},{size:'Unlimited',days:30,price:70}],'CRICKET-US':[{size:'5GB',days:30,price:25},{size:'10GB',days:30,price:35},{size:'Unlimited',days:30,price:55}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['ConEd','PG&E','Duke Energy','FPL']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['American Water']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['Comcast','DirecTV','Dish','Spectrum']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Comcast Xfinity','AT&T Fiber','Verizon Fios','Spectrum']},{id:'gas',label:'Gas',icon:'\u{1F525}',providers:['National Grid','SoCalGas']}],banks:['Chase','Bank of America','Wells Fargo','Citibank','US Bank','Capital One','TD Bank','PNC Bank']},
    GBP:{country:'United Kingdom',networks:[{id:'EE-UK',label:'EE',icon:'\u{1F7E2}'},{id:'O2-UK',label:'O2',icon:'\u{1F535}'},{id:'VODAFONE-UK',label:'Vodafone',icon:'\u{1F534}'},{id:'THREE-UK',label:'Three',icon:'\u26AB'}],dataPlans:{'EE-UK':[{size:'5GB',days:30,price:10},{size:'20GB',days:30,price:18},{size:'Unlimited',days:30,price:28}],'O2-UK':[{size:'5GB',days:30,price:9},{size:'20GB',days:30,price:16},{size:'Unlimited',days:30,price:25}],'VODAFONE-UK':[{size:'5GB',days:30,price:10},{size:'20GB',days:30,price:17},{size:'Unlimited',days:30,price:27}],'THREE-UK':[{size:'5GB',days:30,price:8},{size:'20GB',days:30,price:15},{size:'Unlimited',days:30,price:22}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['British Gas','EDF Energy','E.ON','Scottish Power']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['Thames Water','Severn Trent','Yorkshire Water']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['Sky TV','Virgin Media','BT TV']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['BT Broadband','Sky Broadband','Virgin Media','TalkTalk']},{id:'gas',label:'Gas',icon:'\u{1F525}',providers:['British Gas','E.ON','EDF Energy']}],banks:['Barclays','HSBC','Lloyds','NatWest','Santander UK','Halifax','Monzo','Revolut']},
    EUR:{country:'Europe',networks:[{id:'VODAFONE-EU',label:'Vodafone',icon:'\u{1F534}'},{id:'ORANGE-EU',label:'Orange',icon:'\u{1F7E0}'},{id:'TMOBILE-EU',label:'T-Mobile',icon:'\u{1FA77}'},{id:'O2-EU',label:'O2',icon:'\u{1F535}'}],dataPlans:{'VODAFONE-EU':[{size:'5GB',days:30,price:15},{size:'20GB',days:30,price:25},{size:'Unlimited',days:30,price:40}],'ORANGE-EU':[{size:'5GB',days:30,price:12},{size:'20GB',days:30,price:22},{size:'Unlimited',days:30,price:38}],'TMOBILE-EU':[{size:'5GB',days:30,price:10},{size:'20GB',days:30,price:20},{size:'Unlimited',days:30,price:35}],'O2-EU':[{size:'5GB',days:30,price:13},{size:'20GB',days:30,price:23},{size:'Unlimited',days:30,price:37}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['EDF','E.ON','Vattenfall','Iberdrola','Enel']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['Sky','Canal+','Movistar']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Deutsche Telekom','BT','Orange','Telecom Italia']},{id:'gas',label:'Gas',icon:'\u{1F525}',providers:['E.ON','Engie']}],banks:['Deutsche Bank','BNP Paribas','Santander','ING','HSBC Europe','Barclays','UniCredit']},
    INR:{country:'India',networks:[{id:'JIO-IN',label:'Jio',icon:'\u{1F535}'},{id:'AIRTEL-IN',label:'Airtel',icon:'\u{1F534}'},{id:'VI-IN',label:'Vi',icon:'\u{1F7E3}'},{id:'BSNL-IN',label:'BSNL',icon:'\u{1F7E0}'}],dataPlans:{'JIO-IN':[{size:'1GB/day',days:28,price:239},{size:'2GB/day',days:28,price:479},{size:'Unlimited',days:84,price:719}],'AIRTEL-IN':[{size:'1GB/day',days:28,price:265},{size:'2GB/day',days:28,price:499},{size:'Unlimited',days:84,price:839}],'VI-IN':[{size:'1GB/day',days:28,price:249},{size:'2GB/day',days:28,price:479}],'BSNL-IN':[{size:'1GB/day',days:30,price:187},{size:'Unlimited',days:90,price:599}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['TATA Power','Adani Electricity','BSES','MSEDCL']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['Tata Play','Airtel DTH','Sun Direct','Dish TV']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Jio Fiber','Airtel Xstream','ACT Fibernet']},{id:'gas',label:'Gas (LPG)',icon:'\u{1F525}',providers:['HP Gas','Bharat Gas','Indane']}],banks:['SBI','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra','Punjab National Bank']},
    AED:{country:'UAE',networks:[{id:'ETISALAT-AE',label:'Etisalat (e&)',icon:'\u{1F7E2}'},{id:'DU-AE',label:'du',icon:'\u{1F7E3}'}],dataPlans:{'ETISALAT-AE':[{size:'5GB',days:30,price:65},{size:'15GB',days:30,price:110},{size:'Unlimited',days:30,price:180}],'DU-AE':[{size:'5GB',days:30,price:55},{size:'15GB',days:30,price:95},{size:'Unlimited',days:30,price:160}]},bills:[{id:'electricity',label:'Electricity & Water',icon:'\u{1F4A1}',providers:['DEWA','SEWA','ADDC','FEWA']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['eLife TV','du TV','OSN']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Etisalat eLife','du Home']}],banks:['Emirates NBD','ADCB','FAB','Dubai Islamic Bank','Mashreq','ADIB','RAKBank']},
    CAD:{country:'Canada',networks:[{id:'ROGERS-CA',label:'Rogers',icon:'\u{1F534}'},{id:'BELL-CA',label:'Bell',icon:'\u{1F535}'},{id:'TELUS-CA',label:'Telus',icon:'\u{1F7E2}'},{id:'FREEDOM-CA',label:'Freedom',icon:'\u{1F7E3}'}],dataPlans:{'ROGERS-CA':[{size:'5GB',days:30,price:35},{size:'20GB',days:30,price:55},{size:'Unlimited',days:30,price:75}],'BELL-CA':[{size:'5GB',days:30,price:35},{size:'20GB',days:30,price:55},{size:'Unlimited',days:30,price:75}],'TELUS-CA':[{size:'5GB',days:30,price:33},{size:'20GB',days:30,price:52},{size:'Unlimited',days:30,price:70}],'FREEDOM-CA':[{size:'5GB',days:30,price:25},{size:'20GB',days:30,price:40},{size:'Unlimited',days:30,price:55}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['Hydro One','BC Hydro','Hydro-Quebec','Epcor']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['Rogers TV','Bell Fibe','Shaw']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Rogers Internet','Bell Internet','Telus Internet']},{id:'gas',label:'Gas',icon:'\u{1F525}',providers:['Enbridge','FortisBC','Atco Gas']}],banks:['RBC','TD Bank','Scotiabank','BMO','CIBC','National Bank','Tangerine','EQ Bank']},
    AUD:{country:'Australia',networks:[{id:'TELSTRA-AU',label:'Telstra',icon:'\u{1F535}'},{id:'OPTUS-AU',label:'Optus',icon:'\u{1F7E1}'},{id:'VODAFONE-AU',label:'Vodafone',icon:'\u{1F534}'},{id:'TPG-AU',label:'TPG',icon:'\u26AB'}],dataPlans:{'TELSTRA-AU':[{size:'10GB',days:30,price:30},{size:'30GB',days:30,price:50},{size:'Unlimited',days:30,price:65}],'OPTUS-AU':[{size:'10GB',days:30,price:25},{size:'30GB',days:30,price:45},{size:'Unlimited',days:30,price:60}],'VODAFONE-AU':[{size:'10GB',days:30,price:22},{size:'30GB',days:30,price:40},{size:'Unlimited',days:30,price:55}],'TPG-AU':[{size:'10GB',days:30,price:20},{size:'30GB',days:30,price:35},{size:'Unlimited',days:30,price:50}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['AGL','Origin Energy','Energy Australia']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['Sydney Water','Melbourne Water']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['Foxtel','Fetch TV']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Telstra','Optus','TPG','Aussie Broadband']},{id:'gas',label:'Gas',icon:'\u{1F525}',providers:['AGL','Origin Energy']}],banks:['CBA','ANZ','Westpac','NAB','Macquarie','ING Australia']},
    JPY:{country:'Japan',networks:[{id:'DOCOMO-JP',label:'NTT Docomo',icon:'\u{1F534}'},{id:'SOFTBANK-JP',label:'SoftBank',icon:'\u26AB'},{id:'AU-JP',label:'au (KDDI)',icon:'\u{1F7E0}'},{id:'RAKUTEN-JP',label:'Rakuten',icon:'\u{1FA77}'}],dataPlans:{'DOCOMO-JP':[{size:'3GB',days:30,price:1078},{size:'15GB',days:30,price:2970},{size:'Unlimited',days:30,price:4928}],'SOFTBANK-JP':[{size:'3GB',days:30,price:990},{size:'15GB',days:30,price:2970},{size:'Unlimited',days:30,price:4928}],'AU-JP':[{size:'3GB',days:30,price:990},{size:'15GB',days:30,price:2970},{size:'Unlimited',days:30,price:4928}],'RAKUTEN-JP':[{size:'3GB',days:30,price:1078},{size:'Unlimited',days:30,price:3278}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['TEPCO','Kansai Electric','Chubu Electric']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['Tokyo Waterworks','Osaka Waterworks']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['NTT Flets','SoftBank Hikari','au Hikari','NURO']},{id:'gas',label:'Gas',icon:'\u{1F525}',providers:['Tokyo Gas','Osaka Gas']}],banks:['Japan Post Bank','MUFG','SMBC','Mizuho','Rakuten Bank','PayPay Bank']},
    SGD:{country:'Singapore',networks:[{id:'SINGTEL-SG',label:'Singtel',icon:'\u{1F534}'},{id:'STARHUB-SG',label:'StarHub',icon:'\u{1F7E2}'},{id:'M1-SG',label:'M1',icon:'\u{1F535}'},{id:'TPG-SG',label:'TPG',icon:'\u{1F7E3}'}],dataPlans:{'SINGTEL-SG':[{size:'10GB',days:30,price:20},{size:'50GB',days:30,price:35},{size:'Unlimited',days:30,price:50}],'STARHUB-SG':[{size:'10GB',days:30,price:18},{size:'50GB',days:30,price:32},{size:'Unlimited',days:30,price:48}],'M1-SG':[{size:'10GB',days:30,price:18},{size:'50GB',days:30,price:30},{size:'Unlimited',days:30,price:45}],'TPG-SG':[{size:'10GB',days:30,price:15},{size:'50GB',days:30,price:25},{size:'Unlimited',days:30,price:38}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['SP Group','Geneco','Sembcorp']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['PUB Singapore']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Singtel Fibre','StarHub Fibre','M1 Fibre']}],banks:['DBS','OCBC','UOB','Standard Chartered Singapore','Citibank Singapore']},
    EGP:{country:'Egypt',networks:[{id:'ORANGE-EG',label:'Orange',icon:'\u{1F7E0}'},{id:'VODAFONE-EG',label:'Vodafone',icon:'\u{1F534}'},{id:'ETISALAT-EG',label:'Etisalat',icon:'\u{1F7E2}'},{id:'WE-EG',label:'WE',icon:'\u{1F535}'}],dataPlans:{'ORANGE-EG':[{size:'1GB',days:30,price:25},{size:'3GB',days:30,price:60},{size:'10GB',days:30,price:150}],'VODAFONE-EG':[{size:'1GB',days:30,price:23},{size:'3GB',days:30,price:55},{size:'10GB',days:30,price:140}],'ETISALAT-EG':[{size:'1GB',days:30,price:22},{size:'3GB',days:30,price:52},{size:'10GB',days:30,price:135}],'WE-EG':[{size:'1GB',days:30,price:20},{size:'3GB',days:30,price:50},{size:'10GB',days:30,price:130}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['Cairo Electricity','Alexandria Electricity']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['TE Data','Orange Home','Vodafone Home']}],banks:['National Bank of Egypt','Banque Misr','CIB','QNB Egypt','HSBC Egypt']},
    SAR:{country:'Saudi Arabia',networks:[{id:'STC-SA',label:'STC',icon:'\u{1F7E3}'},{id:'MOBILY-SA',label:'Mobily',icon:'\u{1F7E2}'},{id:'ZAIN-SA',label:'Zain',icon:'\u{1F535}'}],dataPlans:{'STC-SA':[{size:'10GB',days:30,price:75},{size:'30GB',days:30,price:130},{size:'Unlimited',days:30,price:200}],'MOBILY-SA':[{size:'10GB',days:30,price:70},{size:'30GB',days:30,price:120},{size:'Unlimited',days:30,price:185}],'ZAIN-SA':[{size:'10GB',days:30,price:68},{size:'30GB',days:30,price:115},{size:'Unlimited',days:30,price:175}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['SEC']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['NWC']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['STC Home','Mobily Home','Zain Home']}],banks:['Al Rajhi Bank','NCB','Riyad Bank','Alinma Bank','SABB']},
    TRY:{country:'Turkey',networks:[{id:'TURKCELL-TR',label:'Turkcell',icon:'\u{1F535}'},{id:'VODAFONE-TR',label:'Vodafone Turkey',icon:'\u{1F534}'},{id:'TURKTELEKOM-TR',label:'Turk Telekom',icon:'\u{1F7E0}'}],dataPlans:{'TURKCELL-TR':[{size:'10GB',days:30,price:150},{size:'30GB',days:30,price:250},{size:'Unlimited',days:30,price:400}],'VODAFONE-TR':[{size:'10GB',days:30,price:140},{size:'30GB',days:30,price:235},{size:'Unlimited',days:30,price:380}],'TURKTELEKOM-TR':[{size:'10GB',days:30,price:135},{size:'30GB',days:30,price:225},{size:'Unlimited',days:30,price:360}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['BEDAS','AYEDAS','TOROSLAR']},{id:'water',label:'Water',icon:'\u{1F4A7}',providers:['ISKI','ASKI','IZSU']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Turk Telekom ADSL','Superonline','Turkcell Superbox']},{id:'gas',label:'Gas',icon:'\u{1F525}',providers:['IGDAS','BASKENTGAZ']}],banks:['Ziraat Bank','Is Bank','Garanti BBVA','Akbank','Yapi Kredi','Halkbank']},
    MXN:{country:'Mexico',networks:[{id:'TELCEL-MX',label:'Telcel',icon:'\u{1F535}'},{id:'MOVISTAR-MX',label:'Movistar',icon:'\u{1F7E2}'},{id:'ATT-MX',label:'AT&T Mexico',icon:'\u{1F535}'}],dataPlans:{'TELCEL-MX':[{size:'3GB',days:30,price:199},{size:'10GB',days:30,price:349},{size:'Unlimited',days:30,price:499}],'MOVISTAR-MX':[{size:'3GB',days:30,price:179},{size:'10GB',days:30,price:299},{size:'Unlimited',days:30,price:449}],'ATT-MX':[{size:'3GB',days:30,price:189},{size:'10GB',days:30,price:329},{size:'Unlimited',days:30,price:479}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['CFE']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Telmex','Izzi','Total Play','Megacable']},{id:'gas',label:'Gas',icon:'\u{1F525}',providers:['Gas Natural','Zeta Gas']}],banks:['BBVA Mexico','Banamex','Santander Mexico','Banorte','HSBC Mexico','Scotiabank Mexico']},
    INR2:{country:'Indonesia',networks:[{id:'TELKOMSEL-ID',label:'Telkomsel',icon:'\u{1F534}'},{id:'INDOSAT-ID',label:'Indosat',icon:'\u{1F7E1}'},{id:'XL-ID',label:'XL Axiata',icon:'\u{1F535}'}],dataPlans:{'TELKOMSEL-ID':[{size:'7GB',days:30,price:65000},{size:'20GB',days:30,price:130000},{size:'Unlimited',days:30,price:199000}],'INDOSAT-ID':[{size:'7GB',days:30,price:55000},{size:'20GB',days:30,price:110000},{size:'Unlimited',days:30,price:179000}],'XL-ID':[{size:'7GB',days:30,price:50000},{size:'20GB',days:30,price:100000},{size:'Unlimited',days:30,price:159000}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['PLN']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['IndiHome','Biznet','FirstMedia']}],banks:['BCA','BRI','Mandiri','BNI','CIMB Niaga','GoPay (GoTo)']},
    IDR:{country:'Indonesia',networks:[{id:'TELKOMSEL-ID',label:'Telkomsel',icon:'\u{1F534}'},{id:'INDOSAT-ID',label:'Indosat',icon:'\u{1F7E1}'},{id:'XL-ID',label:'XL Axiata',icon:'\u{1F535}'}],dataPlans:{'TELKOMSEL-ID':[{size:'7GB',days:30,price:65000},{size:'20GB',days:30,price:130000},{size:'Unlimited',days:30,price:199000}],'INDOSAT-ID':[{size:'7GB',days:30,price:55000},{size:'20GB',days:30,price:110000},{size:'Unlimited',days:30,price:179000}],'XL-ID':[{size:'7GB',days:30,price:50000},{size:'20GB',days:30,price:100000},{size:'Unlimited',days:30,price:159000}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['PLN']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['IndiHome','Biznet','FirstMedia']}],banks:['BCA','BRI','Mandiri','BNI','CIMB Niaga','GoPay (GoTo)']},
    PHP:{country:'Philippines',networks:[{id:'GLOBE-PH',label:'Globe',icon:'\u{1F535}'},{id:'SMART-PH',label:'Smart',icon:'\u{1F7E2}'},{id:'DITO-PH',label:'DITO',icon:'\u{1F7E0}'}],dataPlans:{'GLOBE-PH':[{size:'8GB',days:30,price:299},{size:'25GB',days:30,price:499},{size:'Unlimited',days:30,price:799}],'SMART-PH':[{size:'8GB',days:30,price:279},{size:'25GB',days:30,price:479},{size:'Unlimited',days:30,price:749}],'DITO-PH':[{size:'8GB',days:30,price:199},{size:'25GB',days:30,price:349},{size:'Unlimited',days:30,price:599}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['Meralco','VECO','DLPC']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['PLDT Home','Globe At Home','Converge','Sky Fiber']}],banks:['BDO','BPI','Metrobank','Landbank','PNB','Security Bank','GCash (Mynt)']},
    MYR:{country:'Malaysia',networks:[{id:'MAXIS-MY',label:'Maxis',icon:'\u{1F535}'},{id:'CELCOM-MY',label:'Celcom',icon:'\u{1F7E1}'},{id:'DIGI-MY',label:'Digi',icon:'\u{1F7E1}'},{id:'UMOBILE-MY',label:'U Mobile',icon:'\u{1F7E2}'}],dataPlans:{'MAXIS-MY':[{size:'10GB',days:30,price:38},{size:'30GB',days:30,price:68},{size:'Unlimited',days:30,price:98}],'CELCOM-MY':[{size:'10GB',days:30,price:35},{size:'30GB',days:30,price:65},{size:'Unlimited',days:30,price:95}],'DIGI-MY':[{size:'10GB',days:30,price:33},{size:'30GB',days:30,price:60},{size:'Unlimited',days:30,price:88}],'UMOBILE-MY':[{size:'10GB',days:30,price:28},{size:'30GB',days:30,price:55},{size:'Unlimited',days:30,price:80}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['TNB','SESB']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['unifi','Maxis Home','TIME']}],banks:['Maybank','CIMB','Public Bank','RHB','Hong Leong Bank','AmBank','Bank Islam']},
    BRL:{country:'Brazil',networks:[{id:'VIVO-BR',label:'Vivo',icon:'\u{1F7E3}'},{id:'CLARO-BR',label:'Claro',icon:'\u{1F534}'},{id:'TIM-BR',label:'TIM',icon:'\u{1F535}'}],dataPlans:{'VIVO-BR':[{size:'5GB',days:30,price:35},{size:'15GB',days:30,price:55},{size:'Unlimited',days:30,price:80}],'CLARO-BR':[{size:'5GB',days:30,price:32},{size:'15GB',days:30,price:50},{size:'Unlimited',days:30,price:75}],'TIM-BR':[{size:'5GB',days:30,price:30},{size:'15GB',days:30,price:48},{size:'Unlimited',days:30,price:70}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['Enel','Cemig','Copel','Light']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Vivo Fibra','Claro Net','TIM Live']}],banks:['Banco do Brasil','Itau','Bradesco','Caixa','Santander Brasil','Nubank']},
    ZMW:{country:'Zambia',networks:[{id:'MTN-ZM',label:'MTN',icon:'\u{1F7E1}'},{id:'AIRTEL-ZM',label:'Airtel',icon:'\u{1F534}'},{id:'ZAMTEL-ZM',label:'Zamtel',icon:'\u{1F7E2}'}],dataPlans:{'MTN-ZM':[{size:'1GB',days:30,price:25},{size:'3GB',days:30,price:60},{size:'5GB',days:30,price:95}],'AIRTEL-ZM':[{size:'1GB',days:30,price:22},{size:'3GB',days:30,price:55},{size:'5GB',days:30,price:90}],'ZAMTEL-ZM':[{size:'1GB',days:30,price:20},{size:'3GB',days:30,price:50},{size:'5GB',days:30,price:85}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['ZESCO']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['DSTV','GOtv','Startimes']}],banks:['Zanaco','Standard Chartered Zambia','Stanbic Zambia','FNB Zambia','Absa Zambia']},
    UGX:{country:'Uganda',networks:[{id:'MTN-UG',label:'MTN',icon:'\u{1F7E1}'},{id:'AIRTEL-UG',label:'Airtel',icon:'\u{1F534}'},{id:'AFRICELL-UG',label:'Africell',icon:'\u{1F535}'}],dataPlans:{'MTN-UG':[{size:'1GB',days:30,price:7000},{size:'3GB',days:30,price:18000},{size:'5GB',days:30,price:28000}],'AIRTEL-UG':[{size:'1GB',days:30,price:6500},{size:'3GB',days:30,price:16000},{size:'5GB',days:30,price:25000}],'AFRICELL-UG':[{size:'1GB',days:30,price:6000},{size:'3GB',days:30,price:15000},{size:'5GB',days:30,price:23000}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['UMEME','Yaka']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['DSTV','GOtv','Startimes']}],banks:['Stanbic Uganda','DFCU Bank','Centenary Bank','Equity Bank Uganda','Absa Uganda']},
    TZS:{country:'Tanzania',networks:[{id:'VODACOM-TZ',label:'Vodacom',icon:'\u{1F534}'},{id:'AIRTEL-TZ',label:'Airtel',icon:'\u{1F7E0}'},{id:'TIGO-TZ',label:'Tigo',icon:'\u{1F535}'}],dataPlans:{'VODACOM-TZ':[{size:'1GB',days:30,price:3000},{size:'3GB',days:30,price:7500},{size:'5GB',days:30,price:12000}],'AIRTEL-TZ':[{size:'1GB',days:30,price:2800},{size:'3GB',days:30,price:7000},{size:'5GB',days:30,price:11000}],'TIGO-TZ':[{size:'1GB',days:30,price:2500},{size:'3GB',days:30,price:6500},{size:'5GB',days:30,price:10000}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['TANESCO']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['DSTV','Startimes','Azam TV']}],banks:['CRDB Bank','NMB Bank','NBC','Stanbic Tanzania','Absa Tanzania']},
    RWF:{country:'Rwanda',networks:[{id:'MTN-RW',label:'MTN',icon:'\u{1F7E1}'},{id:'AIRTEL-RW',label:'Airtel',icon:'\u{1F534}'}],dataPlans:{'MTN-RW':[{size:'1GB',days:30,price:1200},{size:'3GB',days:30,price:3000},{size:'5GB',days:30,price:4500}],'AIRTEL-RW':[{size:'1GB',days:30,price:1100},{size:'3GB',days:30,price:2800},{size:'5GB',days:30,price:4200}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['REG','EUCL']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['DSTV','GOtv','Startimes']}],banks:['Bank of Kigali','Equity Bank Rwanda','I&M Bank Rwanda','Ecobank Rwanda']},
    XOF:{country:'West Africa (CFA)',networks:[{id:'ORANGE-WA',label:'Orange',icon:'\u{1F7E0}'},{id:'MTN-WA',label:'MTN',icon:'\u{1F7E1}'},{id:'MOOV-WA',label:'Moov',icon:'\u{1F535}'}],dataPlans:{'ORANGE-WA':[{size:'1GB',days:30,price:1500},{size:'3GB',days:30,price:3500},{size:'5GB',days:30,price:6000}],'MTN-WA':[{size:'1GB',days:30,price:1400},{size:'3GB',days:30,price:3200},{size:'5GB',days:30,price:5500}],'MOOV-WA':[{size:'1GB',days:30,price:1200},{size:'3GB',days:30,price:3000},{size:'5GB',days:30,price:5000}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['CIE','SENELEC','SBEE']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['Canal+','Startimes']}],banks:['Ecobank','UBA West Africa','Bank of Africa','Coris Bank']},
    QAR:{country:'Qatar',networks:[{id:'OOREDOO-QA',label:'Ooredoo',icon:'\u{1F534}'},{id:'VODAFONE-QA',label:'Vodafone Qatar',icon:'\u{1F534}'}],dataPlans:{'OOREDOO-QA':[{size:'10GB',days:30,price:60},{size:'30GB',days:30,price:110},{size:'Unlimited',days:30,price:170}],'VODAFONE-QA':[{size:'10GB',days:30,price:55},{size:'30GB',days:30,price:100},{size:'Unlimited',days:30,price:160}]},bills:[{id:'electricity',label:'Electricity & Water',icon:'\u{1F4A1}',providers:['Kahramaa']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Ooredoo Home','Vodafone Home']}],banks:['QNB','Commercial Bank Qatar','Doha Bank','Qatar Islamic Bank']},
    VND:{country:'Vietnam',networks:[{id:'VIETTEL-VN',label:'Viettel',icon:'\u{1F534}'},{id:'VINAPHONE-VN',label:'Vinaphone',icon:'\u{1F535}'},{id:'MOBIFONE-VN',label:'Mobifone',icon:'\u{1F7E2}'}],dataPlans:{'VIETTEL-VN':[{size:'5GB',days:30,price:70000},{size:'15GB',days:30,price:150000},{size:'Unlimited',days:30,price:220000}],'VINAPHONE-VN':[{size:'5GB',days:30,price:65000},{size:'15GB',days:30,price:140000},{size:'Unlimited',days:30,price:210000}],'MOBIFONE-VN':[{size:'5GB',days:30,price:65000},{size:'15GB',days:30,price:140000},{size:'Unlimited',days:30,price:200000}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['EVN','EVNHANOI','EVNHCMC']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Viettel Fiber','VNPT Fiber','FPT Telecom']}],banks:['Vietcombank','Agribank','BIDV','VietinBank','Techcombank','MB Bank']},
    THB:{country:'Thailand',networks:[{id:'AIS-TH',label:'AIS',icon:'\u{1F7E2}'},{id:'DTAC-TH',label:'DTAC',icon:'\u{1F535}'},{id:'TRUE-TH',label:'True Move',icon:'\u{1F534}'}],dataPlans:{'AIS-TH':[{size:'10GB',days:30,price:299},{size:'30GB',days:30,price:499},{size:'Unlimited',days:30,price:699}],'DTAC-TH':[{size:'10GB',days:30,price:279},{size:'30GB',days:30,price:479},{size:'Unlimited',days:30,price:659}],'TRUE-TH':[{size:'10GB',days:30,price:269},{size:'30GB',days:30,price:459},{size:'Unlimited',days:30,price:629}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['MEA','PEA']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['True Online','AIS Fibre','3BB']}],banks:['Bangkok Bank','Kasikorn Bank','SCB','Krungthai Bank','UOB Thailand']},
    PKR:{country:'Pakistan',networks:[{id:'JAZZ-PK',label:'Jazz',icon:'\u{1F7E0}'},{id:'TELENOR-PK',label:'Telenor',icon:'\u{1F535}'},{id:'ZONG-PK',label:'Zong',icon:'\u{1F534}'},{id:'UFONE-PK',label:'Ufone',icon:'\u{1F7E2}'}],dataPlans:{'JAZZ-PK':[{size:'2GB',days:30,price:200},{size:'6GB',days:30,price:450},{size:'12GB',days:30,price:800}],'TELENOR-PK':[{size:'2GB',days:30,price:190},{size:'6GB',days:30,price:430},{size:'12GB',days:30,price:780}],'ZONG-PK':[{size:'2GB',days:30,price:185},{size:'6GB',days:30,price:420},{size:'12GB',days:30,price:760}],'UFONE-PK':[{size:'2GB',days:30,price:180},{size:'6GB',days:30,price:400},{size:'12GB',days:30,price:740}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['LESCO','KESC','IESCO','GEPCO','FESCO']},{id:'gas',label:'Gas',icon:'\u{1F525}',providers:['SSGC','SNGPL']}],banks:['HBL','MCB Bank','UBL','Allied Bank','Meezan Bank','Bank Alfalah']},
    MAD:{country:'Morocco',networks:[{id:'MAROCTELECOM-MA',label:'Maroc Telecom',icon:'\u{1F7E2}'},{id:'ORANGE-MA',label:'Orange',icon:'\u{1F7E0}'},{id:'INWI-MA',label:'Inwi',icon:'\u{1F535}'}],dataPlans:{'MAROCTELECOM-MA':[{size:'1GB',days:30,price:20},{size:'5GB',days:30,price:70},{size:'10GB',days:30,price:120}],'ORANGE-MA':[{size:'1GB',days:30,price:18},{size:'5GB',days:30,price:65},{size:'10GB',days:30,price:110}],'INWI-MA':[{size:'1GB',days:30,price:15},{size:'5GB',days:30,price:60},{size:'10GB',days:30,price:100}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['ONEE','Redal','Amendis','Lydec']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Maroc Telecom ADSL','Inwi Box','Orange Fibre']}],banks:['Attijariwafa Bank','Banque Populaire','BMCE Bank','CIH Bank','BMCI']},
    ETB:{country:'Ethiopia',networks:[{id:'ETHIOTELECOM-ET',label:'Ethio Telecom',icon:'\u{1F7E2}'},{id:'SAFARICOM-ET',label:'Safaricom Ethiopia',icon:'\u{1F535}'}],dataPlans:{'ETHIOTELECOM-ET':[{size:'1GB',days:30,price:50},{size:'3GB',days:30,price:130},{size:'5GB',days:30,price:200}],'SAFARICOM-ET':[{size:'1GB',days:30,price:45},{size:'3GB',days:30,price:120},{size:'5GB',days:30,price:190}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['EEU']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['ETV','DSTV','Startimes']}],banks:['Commercial Bank of Ethiopia','Dashen Bank','Awash Bank','Abyssinia Bank']},
    ZWL:{country:'Zimbabwe',networks:[{id:'ECONET-ZW',label:'Econet',icon:'\u{1F535}'},{id:'NETONE-ZW',label:'NetOne',icon:'\u{1F7E2}'},{id:'TELECEL-ZW',label:'Telecel',icon:'\u{1F534}'}],dataPlans:{'ECONET-ZW':[{size:'1GB',days:30,price:5},{size:'3GB',days:30,price:12},{size:'5GB',days:30,price:18}],'NETONE-ZW':[{size:'1GB',days:30,price:4},{size:'3GB',days:30,price:10},{size:'5GB',days:30,price:16}],'TELECEL-ZW':[{size:'1GB',days:30,price:4},{size:'3GB',days:30,price:10},{size:'5GB',days:30,price:15}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['ZESA']},{id:'cable',label:'Cable TV',icon:'\u{1F4FA}',providers:['DSTV','GOtv','Startimes','ZBC']}],banks:['CBZ Bank','Stanbic Zimbabwe','FBC Bank','ZB Bank','Steward Bank']},
    COP:{country:'Colombia',networks:[{id:'CLARO-CO',label:'Claro',icon:'\u{1F534}'},{id:'MOVISTAR-CO',label:'Movistar',icon:'\u{1F7E2}'},{id:'TIGO-CO',label:'Tigo',icon:'\u{1F535}'}],dataPlans:{'CLARO-CO':[{size:'3GB',days:30,price:25000},{size:'10GB',days:30,price:50000},{size:'Unlimited',days:30,price:80000}],'MOVISTAR-CO':[{size:'3GB',days:30,price:22000},{size:'10GB',days:30,price:45000},{size:'Unlimited',days:30,price:75000}],'TIGO-CO':[{size:'3GB',days:30,price:20000},{size:'10GB',days:30,price:42000},{size:'Unlimited',days:30,price:70000}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['EPM','Codensa','Electricaribe']},{id:'internet',label:'Internet',icon:'\u{1F310}',providers:['Claro Hogar','Movistar Hogar','ETB']}],banks:['Bancolombia','Davivienda','Banco de Bogota','BBVA Colombia','Nequi']},
    ARS:{country:'Argentina',networks:[{id:'CLARO-AR',label:'Claro',icon:'\u{1F534}'},{id:'PERSONAL-AR',label:'Personal',icon:'\u{1F535}'},{id:'MOVISTAR-AR',label:'Movistar',icon:'\u{1F7E2}'}],dataPlans:{'CLARO-AR':[{size:'5GB',days:30,price:2500},{size:'15GB',days:30,price:4500},{size:'Unlimited',days:30,price:7000}],'PERSONAL-AR':[{size:'5GB',days:30,price:2400},{size:'15GB',days:30,price:4300},{size:'Unlimited',days:30,price:6800}],'MOVISTAR-AR':[{size:'5GB',days:30,price:2300},{size:'15GB',days:30,price:4100},{size:'Unlimited',days:30,price:6500}]},bills:[{id:'electricity',label:'Electricity',icon:'\u{1F4A1}',providers:['Edenor','Edesur','EPEC']},{id:'gas',label:'Gas',icon:'\u{1F525}',providers:['Metrogas','Camuzzi']}],banks:['Banco Nacion','Santander Argentina','BBVA Argentina','Galicia','Macro','Brubank']},
  };
  function getCD(){return GD[WALLET_CONFIG.currency]||GD['NGN'];}
  function getNets(){return getCD().networks||[];}
  function getDPs(){return getCD().dataPlans||{};}
  function getBills(){return getCD().bills||[];}
  function getBanks(){return getCD().banks||[];}
  // Bank name to code mapping per currency
  const BANK_CODES={
    NGN:{'Access Bank':'044','GTBank':'058','Zenith Bank':'057','First Bank':'011','UBA':'033','Fidelity Bank':'070','Sterling Bank':'232','Wema Bank':'035','Keystone Bank':'082','Polaris Bank':'076','Union Bank':'032','Stanbic IBTC':'221','FCMB':'214','Ecobank':'050','Heritage Bank':'030','Jaiz Bank':'301','Kuda Bank':'50211','Opay':'100004','PalmPay':'100033'},
    GHS:{'GCB Bank':'GCB','Ecobank Ghana':'ECO','Absa Ghana':'ABSA','Stanbic Ghana':'STAN','Fidelity Bank Ghana':'FID','Cal Bank':'CAL'},
    KES:{'Equity Bank':'EQT','KCB Bank':'KCB','Co-operative Bank':'COOP','Absa Kenya':'ABSA','NCBA Bank':'NCBA','DTB Bank':'DTB'},
    ZAR:{'Standard Bank':'SBSA','Absa':'ABSA','FNB':'FNB','Nedbank':'NED','Capitec':'CAP','Discovery Bank':'DIS'},
  };
  function getBankCode(bankName){ return (BANK_CODES[WALLET_CONFIG.currency]||{})[bankName] || bankName; }

  function show(){
    document.getElementById('walletOverlay')?.remove();
    const ov=document.createElement('div');
    ov.id='walletOverlay';
    ov.style.cssText='position:fixed;inset:0;background:var(--bg-primary,#0d1520);z-index:200;display:flex;flex-direction:column;overflow:hidden;';
    ov.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:var(--bg-secondary,#111e2e);border-bottom:1px solid rgba(255,255,255,0.08);"><button id="wBk" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;">&#8249;</button><h2 style="font-size:17px;font-weight:700;color:#fff;">&#128176; XamePay</h2><button id="wSt" style="background:none;border:none;color:#00B0A0;font-size:20px;cursor:pointer;">&#9881;&#65039;</button></div><div id="walletContent" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;"></div>';
    document.body.appendChild(ov);
    ov.querySelector('#wBk').addEventListener('click',()=>ov.remove());
    ov.querySelector('#wSt').addEventListener('click',showSett);
    renderS('home');
  }

  function renderS(screen,data={}){
    const c=document.getElementById('walletContent');
    if(!c)return;
    const m={home:rHome,airtime:rAirtime,data:rData,bills:rBills,'bill-pay':rBillPay,send:rSend,load:rLoad,history:rHist};
    c.innerHTML=(m[screen]||rHome)(data);
    attachL(screen,data);
  }

  function txIt(tx){const cr=tx.type==='credit';return '<div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06);"><div style="width:42px;height:42px;background:'+(cr?'rgba(0,176,160,0.15)':'rgba(255,100,100,0.1)')+';border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">'+(tx.icon||'💳')+'</div><div style="flex:1;"><div style="font-size:14px;font-weight:600;color:#fff;">'+tx.label+'</div><div style="font-size:11px;color:#7a9bb5;margin-top:2px;">'+new Date(tx.ts).toLocaleDateString()+' &bull; '+(tx.status||'Completed')+'</div></div><div style="font-size:15px;font-weight:700;color:'+(cr?'#00B0A0':'#ff6464')+'">'+(cr?'+':'-')+fmt(tx.amount)+'</div></div>';}
  function bkBtn(s){return '<button class="wBkSc" data-screen="'+s+'" style="background:none;border:none;color:#00B0A0;font-size:14px;cursor:pointer;margin-bottom:20px;">&#8249; Back</button>';}
  function inp(id,type,ph){return '<input id="'+id+'" type="'+type+'" placeholder="'+ph+'" style="width:100%;background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px 16px;color:#fff;font-size:15px;outline:none;">';}
  function nGrid(cls){return '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">'+getNets().map(n=>'<button class="'+cls+'" data-network="'+n.id+'" style="background:var(--bg-secondary,#111e2e);border:2px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 6px;cursor:pointer;text-align:center;"><div style="font-size:22px;">'+n.icon+'</div><div style="font-size:11px;color:#fff;font-weight:600;margin-top:4px;">'+n.label+'</div></button>').join('')+'</div>';}

  function rHome(){const cd=getCD();return '<div style="padding:24px 20px;">'+(!isConfigured()?'<div style="background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:12px;padding:14px;margin-bottom:20px;text-align:center;"><div style="font-size:13px;color:#FFA500;font-weight:600;">&#9881; Demo Mode &mdash; '+cd.country+'</div><div style="font-size:12px;color:#7a9bb5;margin-top:4px;">Add API keys in wallet settings to go live</div></div>':'<div style="background:rgba(0,176,160,0.1);border:1px solid rgba(0,176,160,0.2);border-radius:12px;padding:10px 14px;margin-bottom:20px;text-align:center;font-size:13px;color:#00B0A0;font-weight:600;">&#127758; '+cd.country+'</div>')+'<div style="background:linear-gradient(135deg,#00B0A0,#008A7D);border-radius:20px;padding:28px 24px;margin-bottom:24px;position:relative;overflow:hidden;"><div style="position:absolute;top:-20px;right:-20px;width:100px;height:100px;background:rgba(255,255,255,0.08);border-radius:50%;"></div><div style="font-size:12px;color:rgba(255,255,255,0.8);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Wallet Balance</div><div style="font-size:32px;font-weight:800;color:#fff;margin-bottom:4px;">'+fmt(_balance)+'</div><div style="font-size:12px;color:rgba(255,255,255,0.7);">XamePay &bull; '+WALLET_CONFIG.currency+'</div><div style="display:flex;gap:10px;margin-top:20px;"><button class="wab" data-screen="load" style="flex:1;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:#fff;padding:10px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">+ Add Money</button><button class="wab" data-screen="send" style="flex:1;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:#fff;padding:10px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">&#8599; Send</button><button class="wab" data-screen="history" style="flex:1;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:#fff;padding:10px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">&#128202; History</button></div></div><div style="font-size:13px;font-weight:700;color:#7a9bb5;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">Quick Actions</div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px;">'+ [{s:'airtime',i:'📱',l:'Airtime'},{s:'data',i:'📶',l:'Data'},{s:'bills',i:'🧾',l:'Bills'},{s:'send',i:'💸',l:'Send'}].map(a=>'<button class="wab" data-screen="'+a.s+'" style="background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;"><span style="font-size:26px;">'+a.i+'</span><span style="font-size:12px;color:#fff;font-weight:600;">'+a.l+'</span></button>').join('')+'</div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;"><div style="font-size:13px;font-weight:700;color:#7a9bb5;letter-spacing:1px;text-transform:uppercase;">Recent</div><button class="wab" data-screen="history" style="background:none;border:none;color:#00B0A0;font-size:13px;cursor:pointer;">See all</button></div>'+(_transactions.length===0?'<div style="text-align:center;padding:32px;color:#7a9bb5;"><div style="font-size:36px;margin-bottom:10px;">💳</div><div>No transactions yet</div></div>':_transactions.slice(0,5).map(txIt).join(''))+'</div>';}
  function rAirtime(){return '<div style="padding:24px 20px;">'+bkBtn('home')+'<h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">📱 Buy Airtime</h3><p style="font-size:13px;color:#7a9bb5;margin-bottom:24px;">Top up any network instantly</p><div style="margin-bottom:20px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Select Network</label>'+nGrid('network-btn')+'</div><div style="margin-bottom:16px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Phone Number</label>'+inp('airtimePhone','tel','Enter phone number')+'</div><div style="margin-bottom:24px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Amount</label><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">'+ [50,100,200,500,1000,2000].map(a=>'<button class="amt-btn" data-amount="'+a+'" style="background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">'+fmt(a)+'</button>').join('')+'</div>'+inp('airtimeAmount','number','Or enter custom amount')+'</div><div style="background:var(--bg-secondary,#111e2e);border-radius:12px;padding:14px;margin-bottom:20px;display:flex;justify-content:space-between;font-size:13px;"><span style="color:#7a9bb5;">Balance</span><span style="color:#fff;font-weight:600;">'+fmt(_balance)+'</span></div><button id="buyAirtimeBtn" style="width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:14px;padding:16px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">Buy Airtime</button></div>';}
  function rData(){return '<div style="padding:24px 20px;">'+bkBtn('home')+'<h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">📶 Buy Data</h3><p style="font-size:13px;color:#7a9bb5;margin-bottom:24px;">Choose a data plan</p><div style="margin-bottom:20px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Select Network</label>'+nGrid('data-net-btn')+'</div><div style="margin-bottom:16px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Phone Number</label>'+inp('dataPhone','tel','Enter phone number')+'</div><div id="dataPlansContainer" style="margin-bottom:24px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Select a Plan</label><div style="text-align:center;padding:20px;color:#7a9bb5;font-size:13px;">Select a network first</div></div><button id="buyDataBtn" style="width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:14px;padding:16px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">Buy Data</button></div>';}
  function rBills(){return '<div style="padding:24px 20px;">'+bkBtn('home')+'<h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">🧾 Pay Bills</h3><p style="font-size:13px;color:#7a9bb5;margin-bottom:24px;">Pay utility bills easily</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">'+getBills().map(b=>'<button class="bill-cat-btn" data-bill="'+b.id+'" style="background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px 16px;cursor:pointer;text-align:center;"><div style="font-size:32px;margin-bottom:10px;">'+b.icon+'</div><div style="font-size:14px;font-weight:700;color:#fff;">'+b.label+'</div></button>').join('')+'</div></div>';}
  function rBillPay(data){const cat=getBills().find(b=>b.id===data.billId);if(!cat)return '';return '<div style="padding:24px 20px;">'+bkBtn('bills')+'<h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:20px;">'+cat.icon+' '+cat.label+'</h3><div style="margin-bottom:16px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Provider</label><select id="billProvider" style="width:100%;background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px;color:#fff;font-size:15px;outline:none;">'+cat.providers.map(p=>'<option value="'+p+'">'+p+'</option>').join('')+'</select></div><div style="margin-bottom:16px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Meter/Account Number</label>'+inp('billAccountNo','text','Enter account number')+'</div><div style="margin-bottom:24px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Amount</label>'+inp('billAmount','number','Enter amount')+'</div><button id="payBillBtn" style="width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:14px;padding:16px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">Pay '+cat.label+'</button></div>';}
  function rSend(){const contacts=(typeof CONTACTS!=='undefined'?CONTACTS:[]).filter(c=>c.id!==USER?.xameId);const banks=getBanks();return '<div style="padding:24px 20px;">'+bkBtn('home')+'<h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">💸 Send Money</h3><p style="font-size:13px;color:#7a9bb5;margin-bottom:20px;">Send to contacts or bank</p><div style="display:flex;gap:10px;margin-bottom:20px;"><button class="send-tab" data-tab="contact" style="flex:1;padding:10px;border-radius:10px;background:#00B0A0;border:none;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">To Contact</button><button class="send-tab" data-tab="bank" style="flex:1;padding:10px;border-radius:10px;background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">To Bank</button></div><div id="sendContactTab" style="overflow:visible;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Select Contact</label><div id="contactScrollList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;max-height:none;overflow-y:visible;">'+(contacts.length===0?'<div style="color:#7a9bb5;font-size:13px;text-align:center;padding:16px;">No contacts</div>':contacts.map(c=>'<button class="send-contact-btn" data-id="'+c.id+'" data-name="'+(c.name||c.id)+'" style="display:flex;align-items:center;gap:12px;background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;cursor:pointer;text-align:left;"><div style="width:36px;height:36px;background:linear-gradient(135deg,#00B0A0,#008A7D);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0;">'+(c.name||c.id).charAt(0).toUpperCase()+'</div><div><div style="font-size:14px;font-weight:600;color:#fff;">'+(c.name||c.id)+'</div><div style="font-size:11px;color:#7a9bb5;">'+c.id+'</div></div></button>').join(''))+'</div><div id="selContactDisplay" style="display:none;background:rgba(0,176,160,0.1);border:1px solid rgba(0,176,160,0.3);border-radius:12px;padding:12px;margin-bottom:16px;font-size:13px;color:#00B0A0;font-weight:600;"></div></div><div id="sendBankTab" style="display:none;"><div style="margin-bottom:12px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Select Bank</label><input id="bankSearch" type="text" placeholder="🔍 Search bank..." style="width:100%;background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:12px 14px;color:#fff;font-size:14px;outline:none;margin-bottom:6px;box-sizing:border-box;"><div id="bankListContainer" style="max-height:160px;overflow-y:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.08);"><div style="padding:12px;color:#7a9bb5;font-size:13px;text-align:center;">⏳ Loading banks...</div></div><div id="selectedBankDisplay" style="display:none;margin-top:8px;padding:10px 14px;background:rgba(0,176,160,0.1);border:1px solid rgba(0,176,160,0.3);border-radius:10px;font-size:13px;color:#00B0A0;font-weight:600;"></div><input type="hidden" id="bankName" value=""></div><div style="margin-bottom:12px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Account Number</label>'+inp('bankAccount','text','Enter account number')+'<div id="verifyNotice" style="font-size:11px;margin-top:6px;"></div></div><div style="margin-bottom:16px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Account Name</label>'+inp('bankAccName','text','Account holder name')+'<div style="margin-bottom:16px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Account Name</label><div id="resolvedName" style="background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px;color:#7a9bb5;font-size:14px;min-height:48px;">Enter account number to verify</div></div>'
      +'</div></div><div style="margin-bottom:24px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Amount</label>'+inp('sendAmount','number','Enter amount')+'<div style="font-size:12px;color:#7a9bb5;margin-top:6px;">Balance: '+fmt(_balance)+'</div></div><button id="sendMoneyBtn" style="width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:14px;padding:16px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">Send Money</button></div>';}
  function rLoad(){const methods=[{id:'card',icon:'💳',title:'Debit/Credit Card',desc:'Instant &bull; Visa, Mastercard, Verve'},{id:'transfer',icon:'🏦',title:'Bank Transfer',desc:'Instant &bull; Virtual account'},{id:'ussd',icon:'📟',title:'USSD',desc:'No internet needed'},{id:'receive',icon:'📥',title:'Receive from Contact',desc:'From another XamePage user'}];return '<div style="padding:24px 20px;">'+bkBtn('home')+'<h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">💳 Add Money</h3><p style="font-size:13px;color:#7a9bb5;margin-bottom:24px;">Choose how to fund your wallet</p><div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px;">'+methods.map(m=>'<button class="load-method-btn" data-method="'+m.id+'" style="display:flex;align-items:center;gap:16px;background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px;cursor:pointer;text-align:left;"><span style="font-size:28px;">'+m.icon+'</span><div style="flex:1;"><div style="font-size:15px;font-weight:700;color:#fff;">'+m.title+'</div><div style="font-size:12px;color:#7a9bb5;margin-top:3px;">'+m.desc+'</div></div><span style="color:#7a9bb5;font-size:18px;">&#8250;</span></button>').join('')+'</div><div id="loadMethodDetail"></div></div>';}
  function rHist(){return '<div style="padding:24px 20px;">'+bkBtn('home')+'<h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:20px;">📊 Transaction History</h3>'+(_transactions.length===0?'<div style="text-align:center;padding:48px 20px;color:#7a9bb5;"><div style="font-size:48px;margin-bottom:14px;">📭</div><div style="font-size:15px;font-weight:600;">No transactions yet</div></div>':_transactions.map(txIt).join(''))+'</div>';}

  // ── Bills Payment UI ────────────────────────────────────────────────────────
  function rBills(){
    return '<div style="padding:24px 20px;">'+bkBtn('home')+'<h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:20px;">🧾 Pay Bills</h3>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      +[{type:'electricity',icon:'⚡',label:'Electricity'},{type:'tv',icon:'📺',label:'TV / Cable'},{type:'internet',icon:'🌐',label:'Internet'},{type:'airtime',icon:'📱',label:'Airtime'},{type:'data',icon:'📶',label:'Data Bundle'}]
        .map(b=>'<button class="bill-cat-btn" data-type="'+b.type+'" style="background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:10px;"><span style="font-size:32px;">'+b.icon+'</span><span style="font-size:13px;color:#fff;font-weight:600;">'+b.label+'</span></button>')
        .join('')
      +'</div></div>';
  }

  function attachBillsListeners(ov){
    ov.querySelectorAll('.bill-cat-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{ showBillCategory(ov, btn.dataset.type); });
    });
  }

  function showBillCategory(ov, type){
    const content = ov.querySelector('#walletContent');
    const cc = {'NGN':'NG','GHS':'GH','KES':'KE','ZAR':'ZA','USD':'US','GBP':'GB'}[WALLET_CONFIG.currency]||'NG';
    content.innerHTML = '<div style="padding:24px 20px;"><button id="billsBack" style="background:none;border:none;color:#00B0A0;font-size:14px;cursor:pointer;margin-bottom:16px;">← Back</button><h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:16px;">Loading...</h3></div>';
    ov.querySelector('#billsBack')?.addEventListener('click',()=>{ content.innerHTML=rBills(); attachBillsListeners(ov); });
    fetch(serverURL+'/api/wallet/bills/categories?type='+type+'&country='+cc)
      .then(r=>r.json()).then(data=>{
        if(!data.success || !data.categories.length){
          content.innerHTML='<div style="padding:24px 20px;"><button id="billsBack2" style="background:none;border:none;color:#00B0A0;font-size:14px;cursor:pointer;margin-bottom:16px;">← Back</button><div style="text-align:center;padding:40px;color:#7a9bb5;"><div style="font-size:48px;">😕</div><div style="margin-top:12px;">No billers available for your region</div></div></div>';
          ov.querySelector('#billsBack2')?.addEventListener('click',()=>{ content.innerHTML=rBills(); attachBillsListeners(ov); });
          return;
        }
        const icons = {electricity:'⚡',tv:'📺',internet:'🌐',airtime:'📱',data:'📶'};
        content.innerHTML='<div style="padding:24px 20px;"><button id="billsBack3" style="background:none;border:none;color:#00B0A0;font-size:14px;cursor:pointer;margin-bottom:16px;">← Back</button><h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:16px;">'+(icons[type]||'🧾')+' Select Biller</h3>'
          +data.categories.map(cat=>'<div class="biller-item" data-biller="'+encodeURIComponent(JSON.stringify(cat))+'" style="background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;margin-bottom:10px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;"><span style="font-size:14px;font-weight:600;color:#fff;">'+cat.name+'</span><span style="color:#7a9bb5;">›</span></div>')
          .join('')+'</div>';
        ov.querySelector('#billsBack3')?.addEventListener('click',()=>{ content.innerHTML=rBills(); attachBillsListeners(ov); });
        ov.querySelectorAll('.biller-item').forEach(item=>{
          item.addEventListener('click',()=>{
            const cat = JSON.parse(decodeURIComponent(item.dataset.biller));
            showBillerForm(ov, cat, type);
          });
        });
      }).catch(()=>{
        content.innerHTML='<div style="padding:24px;">← <button id="billsBack4" style="background:none;border:none;color:#00B0A0;cursor:pointer;">Back</button><div style="color:#ff6464;margin-top:20px;">Failed to load billers</div></div>';
        ov.querySelector('#billsBack4')?.addEventListener('click',()=>{ content.innerHTML=rBills(); attachBillsListeners(ov); });
      });
  }

  function showBillerForm(ov, cat, type){
    const content = ov.querySelector('#walletContent');
    const hasItems = cat.items && cat.items.length > 0;
    const firstItem = hasItems ? cat.items[0] : {};
    const labelName = firstItem.label_name || 'Customer ID';
    const isFixed = firstItem.amount && firstItem.amount > 0;
    content.innerHTML='<div style="padding:24px 20px;">'
      +'<button id="billerBack" style="background:none;border:none;color:#00B0A0;font-size:14px;cursor:pointer;margin-bottom:16px;">← Back</button>'
      +'<h3 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">'+cat.name+'</h3>'
      +'<p style="font-size:12px;color:#7a9bb5;margin-bottom:20px;">Balance: '+fmt(_balance)+'</p>'
      +(cat.items.length>1?'<div style="margin-bottom:16px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Select Package</label><select id="billItem" style="width:100%;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;">'
        +cat.items.map(i=>'<option value="'+i.item_code+'" data-amount="'+i.amount+'">'+i.label+(i.amount?' — '+fmt(i.amount):'')+'</option>').join('')
        +'</select></div>':'')
      +'<div style="margin-bottom:16px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">'+labelName+'</label>'
      +'<input id="billCustomer" type="text" placeholder="Enter '+labelName+'" style="width:100%;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;">'
      +'<div id="billValidate" style="font-size:12px;margin-top:6px;color:#7a9bb5;"></div></div>'
      +(!isFixed?'<div style="margin-bottom:16px;"><label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Amount</label><input id="billAmount" type="number" placeholder="Enter amount" style="width:100%;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;"></div>':'')
      +'<button id="payBillBtn" style="width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:14px;padding:16px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px;">Pay Now</button>'
      +'</div>';

    ov.querySelector('#billerBack')?.addEventListener('click',()=>{ showBillCategory(ov, type); });

    // Auto-validate customer ID
    let validateTimer = null;
    ov.querySelector('#billCustomer')?.addEventListener('input', function(){
      clearTimeout(validateTimer);
      const val = this.value.trim();
      const validateEl = ov.querySelector('#billValidate');
      if(val.length < 4){ validateEl.textContent=''; return; }
      validateEl.textContent = 'Validating...'; validateEl.style.color='#7a9bb5';
      validateTimer = setTimeout(()=>{
        const itemCode = ov.querySelector('#billItem')?.value || firstItem.item_code;
        fetch(serverURL+'/api/wallet/bills/validate', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ item_code: itemCode, biller_code: cat.biller_code, customer: val })
        }).then(r=>r.json()).then(res=>{
          if(res.success){ validateEl.textContent='✅ '+res.name+(res.address?' — '+res.address:''); validateEl.style.color='#00B0A0'; }
          else { validateEl.textContent='⚠️ Could not validate — you can still proceed'; validateEl.style.color='#f0a500'; }
        }).catch(()=>{ validateEl.textContent='⚠️ Validation unavailable'; validateEl.style.color='#f0a500'; });
      }, 800);
    });

    // Pay bill
    ov.querySelector('#payBillBtn')?.addEventListener('click',()=>{
      const customer = ov.querySelector('#billCustomer')?.value.trim();
      const itemCode = ov.querySelector('#billItem')?.value || firstItem.item_code;
      const selectedItem = cat.items.find(i=>i.item_code===itemCode) || firstItem;
      const amt = parseFloat(ov.querySelector('#billAmount')?.value) || selectedItem.amount || 0;
      if(!customer){ showNotification('Enter '+labelName); return; }
      if(!amt||amt<1){ showNotification('Enter amount'); return; }
      if(amt>_balance){ showNotification('Insufficient balance'); return; }
      const cc = {'NGN':'NG','GHS':'GH','KES':'KE','ZAR':'ZA'}[WALLET_CONFIG.currency]||'NG';
      showNotification('Processing payment...');
      fetch(serverURL+'/api/wallet/bills/pay',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ userId:USER?.xameId, biller_code:cat.biller_code, item_code:itemCode, customer, amount:amt, country:cc })
      }).then(r=>r.json()).then(res=>{
        if(res.success){
          loadWallet();
          showNotification('✅ Bill paid successfully!'+(res.fee?' Fee: '+fmt(res.fee):''));
          content.innerHTML=rBills(); attachBillsListeners(ov);
        } else {
          showNotification('❌ '+(res.message||'Payment failed'));
        }
      }).catch(()=>showNotification('❌ Network error'));
    });
  }

  function showLoadDetail(method){
    const d=document.querySelector('#loadMethodDetail');if(!d)return;
    // Generate a consistent virtual account number from user's xameId
    const uid = USER?.xameId || 'user';
    let hash = 0;
    for (let i = 0; i < uid.length; i++) { hash = ((hash << 5) - hash) + uid.charCodeAt(i); hash |= 0; }
    const va = '0' + (Math.abs(hash) % 1000000000).toString().padStart(9, '0');
    const bankMap={NGN:'Wema Bank',GHS:'GCB Bank',KES:'Equity Bank',ZAR:'Standard Bank',USD:'Chase Bank',GBP:'Barclays',EUR:'Deutsche Bank',INR:'SBI',AED:'Emirates NBD',CAD:'RBC',AUD:'CBA',JPY:'Japan Post Bank',SGD:'DBS',EGP:'National Bank of Egypt',SAR:'Al Rajhi Bank',TRY:'Ziraat Bank',MXN:'BBVA Mexico',IDR:'BCA',PHP:'BDO',MYR:'Maybank',BRL:'Banco do Brasil',ZMW:'Zanaco',UGX:'Stanbic Uganda',TZS:'CRDB Bank',RWF:'Bank of Kigali',XOF:'Ecobank',QAR:'QNB',VND:'Vietcombank',THB:'Bangkok Bank',PKR:'HBL',MAD:'Attijariwafa Bank',ETB:'Commercial Bank of Ethiopia',ZWL:'CBZ Bank',COP:'Bancolombia',ARS:'Banco Nacion'};
    const bank = bankMap[WALLET_CONFIG.currency] || 'Partner Bank';
    const html={
      card:'<div style="background:var(--bg-secondary,#111e2e);border-radius:16px;padding:20px;"><h4 style="color:#fff;margin-bottom:16px;">💳 Pay with Card</h4><input type="text" placeholder="Card Number" maxlength="19" style="width:100%;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;margin-bottom:10px;outline:none;"><div style="display:flex;gap:10px;margin-bottom:10px;"><input type="text" placeholder="MM/YY" maxlength="5" style="flex:1;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;"><input type="text" placeholder="CVV" maxlength="3" style="flex:1;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;"></div><input type="number" id="cardAmount" placeholder="Amount" style="width:100%;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;margin-bottom:14px;outline:none;"><button id="payWithCardBtn" style="width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:12px;padding:14px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">Fund Wallet</button><p style="font-size:11px;color:#7a9bb5;text-align:center;margin-top:10px;">&#128274; Secured by '+(WALLET_CONFIG.defaultProvider==='flutterwave'?'Flutterwave':'Paystack')+'</p></div>',
      transfer:'<div style="background:var(--bg-secondary,#111e2e);border-radius:16px;padding:20px;"><h4 style="color:#fff;margin-bottom:4px;">🏦 Bank Transfer</h4><p style="font-size:12px;color:#7a9bb5;margin-bottom:16px;">Transfer to this account &mdash; credited instantly</p><div style="background:var(--bg-primary,#0d1520);border-radius:12px;padding:16px;"><div style="display:flex;justify-content:space-between;margin-bottom:10px;"><span style="font-size:12px;color:#7a9bb5;">Bank</span><span id="vaBank" style="font-size:14px;font-weight:700;color:#fff;">'+(persistentStorage.get('wallet:va:bank')||bank)+'</span></div><div style="display:flex;justify-content:space-between;margin-bottom:10px;"><span style="font-size:12px;color:#7a9bb5;">Account Number</span><span id="vaNumber" style="font-size:16px;font-weight:800;color:#00B0A0;">'+(persistentStorage.get('wallet:va:number')||va)+'</span></div><div style="display:flex;justify-content:space-between;margin-bottom:10px;"><span style="font-size:12px;color:#7a9bb5;">Account Name</span><span style="font-size:13px;font-weight:600;color:#fff;">XamePay/'+(USER?.xameId||'User')+'</span></div><div style="display:flex;justify-content:space-between;"><span style="font-size:12px;color:#7a9bb5;">Provider</span><span style="font-size:12px;color:#7a9bb5;font-weight:600;">'+(WALLET_CONFIG.defaultProvider==='paystack'?'Paystack':'Flutterwave')+'</span></div></div>'+(isConfigured()?'':'<div style="font-size:11px;color:#FFA500;background:rgba(255,165,0,0.1);border-radius:8px;padding:8px;margin-top:10px;text-align:center;">Add API keys in settings for a real account</div>')+'<button id="copyAccBtn" style="width:100%;background:rgba(0,176,160,0.15);border:1px solid rgba(0,176,160,0.3);border-radius:12px;padding:12px;color:#00B0A0;font-size:14px;font-weight:600;cursor:pointer;margin-top:12px;">📋 Copy Account Number</button></div>',
      ussd:(()=>{
        const ussdMap={
          NGN:[['GTBank','*737*'],['Access','*901*'],['Zenith','*966*'],['UBA','*919*'],['First Bank','*894*'],['GTBank Pay','*737*2*']],
          GHS:[['MTN MoMo','*170*'],['Vodafone Cash','*110*'],['AirtelTigo Money','*500*']],
          KES:[['M-Pesa','*334*'],['Airtel Money','*339*']],
          ZAR:[['FNB','*120*321*'],['Standard Bank','*120*2345*'],['Capitec','*120*3279*']],
          USD:[['Zelle (not USSD)','N/A']],
          GBP:[['Faster Payments (not USSD)','N/A']],
        };
        const codes=ussdMap[WALLET_CONFIG.currency]||[['Bank USSD','*XXX*']];
        return '<div style="background:var(--bg-secondary,#111e2e);border-radius:16px;padding:20px;"><h4 style="color:#fff;margin-bottom:16px;">📟 USSD Payment</h4>'+codes.map(b=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:14px;background:var(--bg-primary,#0d1520);border-radius:10px;margin-bottom:8px;"><span style="font-size:14px;color:#fff;">'+b[0]+'</span><span style="font-size:13px;font-weight:700;color:#00B0A0;">'+b[1]+'amount*'+va+'#</span></div>').join('')+'<p style="font-size:11px;color:#7a9bb5;text-align:center;margin-top:10px;">Replace amount with the amount to send</p></div>';
      })(),
      receive:'<div style="background:var(--bg-secondary,#111e2e);border-radius:16px;padding:20px;text-align:center;"><h4 style="color:#fff;margin-bottom:8px;">📥 Receive from Contact</h4><p style="font-size:13px;color:#7a9bb5;margin-bottom:16px;">Share your Xame-ID to receive money</p><div style="background:var(--bg-primary,#0d1520);border-radius:12px;padding:20px;margin-bottom:14px;"><div style="font-size:12px;color:#7a9bb5;margin-bottom:6px;">Your Xame-ID</div><div style="font-size:22px;font-weight:800;color:#00B0A0;">'+(USER?.xameId||'Unknown')+'</div></div><button id="shareXameIdBtn" style="width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:12px;padding:14px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">📤 Share Xame-ID</button></div>',
    };
    d.innerHTML=html[method]||'';
    d.querySelector('#payWithCardBtn')?.addEventListener('click',()=>{
      const amt=parseFloat(d.querySelector('#cardAmount')?.value);
      if(!amt||amt<1){showNotification('Enter amount');return;}
      // Get public key from server
      fetch(serverURL+'/api/wallet/pubkey').then(r=>r.json()).then(pubData=>{
        const flwPub = pubData.flw||'';
        const pskPub = pubData.psk||'';
        if(!flwPub && !pskPub){ processPayment('load-card',{amount:amt}); return; }
      // Paystack checkout
      if(pubData.provider==='paystack' && pskPub){
        const handler = PaystackPop.setup({
          key: pskPub,
          email: USER?.email || (USER?.xameId + '@xamepage.app'),
          amount: amt * 100,
          currency: WALLET_CONFIG.currency,
          ref: 'xamepay-' + Date.now(),
          onClose: () => {},
          callback: (response) => {
            if(response.status === 'success'){
              updateBalance(amt);
              addTx({label:'Wallet funded via Card',icon:'💳',amount:amt,type:'credit',status:'Completed'});
              showNotification('✅ Payment successful! +' + fmt(amt));
              renderS('home');
            }
          }
        });
        handler.openIframe();
        return;
      }
      // Real Flutterwave checkout
      if(!flwPub){ processPayment('load-card',{amount:amt}); return; }
      FlutterwaveCheckout({
        public_key: flwPub,
        tx_ref: 'xamepay-' + Date.now(),
        amount: amt,
        currency: WALLET_CONFIG.currency,
        customer: { email: (USER?.email || USER?.xameId + '@xamepage.app'), name: USER?.preferredName || USER?.firstName || USER?.xameId },
        customizations: { title: 'XamePay', description: 'Wallet Top-up', logo: '' },
        callback: async (response) => {
          if(response.status === 'successful') {
            showNotification('Verifying payment...');
            try {
              const res = await fetch(serverURL+'/api/wallet/fund/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transaction_id: response.transaction_id, expected_amount: amt, currency: WALLET_CONFIG.currency, userId: USER?.xameId })
              });
              const data = await res.json();
              if(data.success) {
                loadWallet();
                const sdlg=document.createElement('div');
                sdlg.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;';
                sdlg.innerHTML='<div style="background:var(--bg-secondary,#111e2e);border-radius:20px;padding:32px;text-align:center;max-width:300px;width:90%;"><div style="font-size:48px;margin-bottom:16px;">✅</div><div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:8px;">Payment Successful!</div><div style="font-size:22px;font-weight:800;color:#00B0A0;margin-bottom:20px;">+'+fmt(amt)+'</div><button id="sdOk" style="width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:12px;padding:14px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">Done</button></div>';
                document.body.appendChild(sdlg);
                sdlg.querySelector('#sdOk').addEventListener('click',()=>{sdlg.remove();renderS('home');});
              } else { showNotification('Payment verification failed: ' + data.message); }
            } catch(e) { showNotification('Verification error'); }
          } else { showNotification('Payment was not completed'); }
        },
        onclose: () => {}
      });
      }).catch(()=>processPayment('load-card',{amount:amt}));
    });
    d.querySelector('#copyAccBtn')?.addEventListener('click',()=>navigator.clipboard?.writeText(va).then(()=>showNotification('Copied!')));

    // Auto-fetch real virtual account if API keys are configured
    if(isConfigured() && !persistentStorage.get('wallet:va:number')){
      const provider = WALLET_CONFIG.defaultProvider;
      const secret = provider==='paystack' ? WALLET_CONFIG.paystack.secretKey : WALLET_CONFIG.flutterwave.secretKey;
      const endpoint = provider==='paystack' ? '/api/wallet/psk/virtual-account' : '/api/wallet/flw/virtual-account';
      const headerKey = provider==='paystack' ? 'x-psk-secret' : 'x-flw-secret';
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [headerKey]: secret },
        body: JSON.stringify({ userId: USER?.xameId, email: USER?.email, name: USER?.preferredName||USER?.firstName, currency: WALLET_CONFIG.currency })
      }).then(r=>r.json()).then(data=>{
        if(data.success && data.account){
          const accNum = data.account.account_number;
          const accBank = data.account.bank_name || data.account.bank || bank;
          persistentStorage.set('wallet:va:number', accNum);
          persistentStorage.set('wallet:va:bank', accBank);
          // Update displayed values
          const el = d.querySelector('#vaNumber');
          const bk = d.querySelector('#vaBank');
          if(el) el.textContent = accNum;
          if(bk) bk.textContent = accBank;
        }
      }).catch(()=>{});
    } else if(persistentStorage.get('wallet:va:number')) {
      // Use cached virtual account
      const el = d.querySelector('#vaNumber');
      const bk = d.querySelector('#vaBank');
      if(el) el.textContent = persistentStorage.get('wallet:va:number');
      if(bk) bk.textContent = persistentStorage.get('wallet:va:bank') || bank;
    }
    d.querySelector('#shareXameIdBtn')?.addEventListener('click',()=>{if(navigator.share)navigator.share({title:'Send me money',text:'My XamePay ID: '+(USER?.xameId||'')});else navigator.clipboard?.writeText(USER?.xameId||'').then(()=>showNotification('Xame-ID copied!'));});
  }

  // Country code map for Reloadly
  const CC={NGN:'NG',GHS:'GH',KES:'KE',ZAR:'ZA',USD:'US',GBP:'GB',EUR:'DE',INR:'IN',AED:'AE',CAD:'CA',AUD:'AU',JPY:'JP',SGD:'SG',EGP:'EG',SAR:'SA',TRY:'TR',MXN:'MX',IDR:'ID',PHP:'PH',MYR:'MY',BRL:'BR',ZMW:'ZM',UGX:'UG',TZS:'TZ',RWF:'RW',QAR:'QA',VND:'VN',THB:'TH',PKR:'PK',MAD:'MA',ETB:'ET',ZWL:'ZW',COP:'CO',ARS:'AR'};

  function callReloadly(type, data) {
    const countryCode = CC[WALLET_CONFIG.currency] || 'NG';
    const endpoint = type === 'airtime' ? '/api/wallet/airtime' : '/api/vtu/data';
    const body = {
      phone: data.phone,
      countryCode,
      operatorId: data.network,
      amount: type === 'airtime' ? data.amount : data.plan?.price,
      userId: USER?.xameId
    };
    // Debit wallet first
    const amount = body.amount;
    if(amount > _balance){ showNotification('Insufficient balance'); return; }
    updateBalance(-amount);
    showNotification('Processing...');
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r=>r.json()).then(res=>{
      if(res.success){
        addTx({label:(type==='airtime'?'Airtime':'Data')+' - '+data.phone, icon: type==='airtime'?'📱':'📶', amount, type:'debit', status:'Completed'});
        showNotification('✅ ' + res.message);
        renderS('home');
      } else {
        // Refund on failure
        updateBalance(amount);
        showNotification('❌ Failed: ' + (res.message||'Try again'));
      }
    }).catch(()=>{ updateBalance(amount); showNotification('❌ Network error'); });
  }

  function processPayment(type,data){
    const dlg=document.createElement('div');
    dlg.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;';
    dlg.innerHTML='<div style="background:var(--bg-secondary,#111e2e);border-radius:20px;padding:32px;text-align:center;max-width:280px;width:90%;"><div style="font-size:36px;margin-bottom:16px;">⚙️</div><div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:8px;">Processing...</div></div>';
    document.body.appendChild(dlg);
    setTimeout(()=>{dlg.remove();completePayment(type,data);},1500);
  }

  function completePayment(type,data){
    const map={'airtime':{label:data.network+' Airtime - '+data.phone,icon:'📱',debit:true},'data':{label:data.network+' '+(data.plan?.size)+' Data - '+data.phone,icon:'📶',debit:true},'bill':{label:data.provider+' Bill - '+data.accountNo,icon:'🧾',debit:true},'send-contact':{label:'Sent to '+(data.contact?.name),icon:'💸',debit:true},'send-bank':{label:'Transfer to '+data.accName,icon:'🏦',debit:true},'load-card':{label:'Wallet funded via Card',icon:'💳',debit:false}};
    const tx=map[type];const amount=data.amount||data.plan?.price||0;
    if(tx.debit)updateBalance(-amount);else updateBalance(amount);
    addTx({label:tx.label,icon:tx.icon,amount,type:tx.debit?'debit':'credit',status:WALLET_CONFIG.testMode?'Demo':'Completed'});
    const sdlg=document.createElement('div');
    sdlg.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;';
    sdlg.innerHTML='<div style="background:var(--bg-secondary,#111e2e);border-radius:20px;padding:32px;text-align:center;max-width:300px;width:90%;"><div style="width:64px;height:64px;background:rgba(0,176,160,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;color:#00B0A0;">&#10003;</div><div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:8px;">'+(WALLET_CONFIG.testMode?'Demo Success!':'Success!')+'</div><div style="font-size:22px;font-weight:800;color:#00B0A0;margin-bottom:8px;">'+(tx.debit?'-':'+')+fmt(amount)+'</div><div style="font-size:13px;color:#7a9bb5;margin-bottom:20px;">'+tx.label+'</div>'+(WALLET_CONFIG.testMode?'<div style="font-size:11px;color:#FFA500;background:rgba(255,165,0,0.1);border-radius:8px;padding:8px;margin-bottom:16px;">Demo Mode &mdash; Add API keys for real transactions</div>':'')+'<button id="sdOkBtn" style="width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:12px;padding:14px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">Done</button></div>';
    document.body.appendChild(sdlg);
    sdlg.querySelector('#sdOkBtn').addEventListener('click',()=>{sdlg.remove();renderS('home');});
  }

  function attachL(screen,data){
    const c=document.getElementById('walletContent');if(!c)return;
    c.querySelectorAll('.wab').forEach(b=>b.addEventListener('click',()=>renderS(b.dataset.screen)));
    c.querySelectorAll('.wBkSc').forEach(b=>b.addEventListener('click',()=>renderS(b.dataset.screen)));
    if(screen==='bills'){
      const ov = document.getElementById('walletOverlay');
      c.querySelectorAll('.bill-cat-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{ showBillCategory(ov, btn.dataset.type); });
      });
    }
    if(screen==='airtime'){
      let sNet=null;
      c.querySelectorAll('.network-btn').forEach(b=>b.addEventListener('click',()=>{sNet=b.dataset.network;c.querySelectorAll('.network-btn').forEach(x=>x.style.borderColor='rgba(255,255,255,0.08)');b.style.borderColor='#00B0A0';}));
      c.querySelectorAll('.amt-btn').forEach(b=>b.addEventListener('click',()=>{c.querySelector('#airtimeAmount').value=b.dataset.amount;c.querySelectorAll('.amt-btn').forEach(x=>x.style.borderColor='rgba(255,255,255,0.08)');b.style.borderColor='#00B0A0';}));
      c.querySelector('#buyAirtimeBtn')?.addEventListener('click',()=>{const ph=c.querySelector('#airtimePhone')?.value,amt=parseFloat(c.querySelector('#airtimeAmount')?.value);if(!sNet){showNotification('Select a network');return;}if(!ph||ph.length<6){showNotification('Enter valid phone');return;}if(!amt||amt<1){showNotification('Enter amount');return;}callReloadly('airtime',{network:sNet,phone:ph,amount:amt});});
    }
    if(screen==='data'){
      let sNet=null,sPlan=null;
      c.querySelectorAll('.data-net-btn').forEach(b=>b.addEventListener('click',()=>{
        sNet=b.dataset.network;c.querySelectorAll('.data-net-btn').forEach(x=>x.style.borderColor='rgba(255,255,255,0.08)');b.style.borderColor='#00B0A0';
        const plans=getDPs()[sNet]||[],container=c.querySelector('#dataPlansContainer');
        container.innerHTML='<label style="font-size:13px;color:#7a9bb5;margin-bottom:8px;display:block;">Select a Plan</label><div style="display:flex;flex-direction:column;gap:8px;">'+plans.map((p,i)=>'<button class="plan-btn" data-i="'+i+'" style="display:flex;justify-content:space-between;align-items:center;background:var(--bg-secondary,#111e2e);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;cursor:pointer;"><div><div style="font-size:15px;font-weight:700;color:#fff;">'+p.size+'</div><div style="font-size:11px;color:#7a9bb5;">'+p.days+' days</div></div><div style="font-size:15px;font-weight:700;color:#00B0A0;">'+fmt(p.price)+'</div></button>').join('')+'</div>';
        container.querySelectorAll('.plan-btn').forEach(pb=>pb.addEventListener('click',()=>{sPlan=plans[parseInt(pb.dataset.i)];container.querySelectorAll('.plan-btn').forEach(x=>x.style.borderColor='rgba(255,255,255,0.08)');pb.style.borderColor='#00B0A0';}));
      }));
      c.querySelector('#buyDataBtn')?.addEventListener('click',()=>{const ph=c.querySelector('#dataPhone')?.value;if(!sNet){showNotification('Select a network');return;}if(!ph||ph.length<6){showNotification('Enter valid phone');return;}if(!sPlan){showNotification('Select a plan');return;}callReloadly('data',{network:sNet,phone:ph,plan:sPlan});});
    }
    if(screen==='bills')c.querySelectorAll('.bill-cat-btn').forEach(b=>b.addEventListener('click',()=>renderS('bill-pay',{billId:b.dataset.bill})));
    if(screen==='bill-pay'){c.querySelector('#payBillBtn')?.addEventListener('click',()=>{const prov=c.querySelector('#billProvider')?.value,acc=c.querySelector('#billAccountNo')?.value,amt=parseFloat(c.querySelector('#billAmount')?.value);if(!acc){showNotification('Enter account number');return;}if(!amt||amt<1){showNotification('Enter amount');return;}processPayment('bill',{provider:prov,accountNo:acc,amount:amt,billId:data.billId});});}
    if(screen==='send'){
      // Keys are server-side - always fetch bank list from server
      const _curr = persistentStorage.get('wallet:currency') || WALLET_CONFIG.currency || 'NGN';
      // Full currency to country code map - Flutterwave supports all these
      const CURR_TO_CC = {'NGN':'NG','GHS':'GH','KES':'KE','ZAR':'ZA','TZS':'TZ','UGX':'UG','ZMW':'ZM','RWF':'RW','ETB':'ET','USD':'US','GBP':'GB','EUR':'DE','INR':'IN','CAD':'CA','AUD':'AU','MXN':'MX','BRL':'BR','PHP':'PH','MYR':'MY','INR':'IN','EGP':'EG','MAD':'MA','XOF':'SN','CMR':'CM'};
      const cc = CURR_TO_CC[_curr] || 'NG';
      const loadBankList = (banks) => {
        const wc = document.getElementById('walletContent');
        if(!wc) return;
        const container = wc.querySelector('#bankListContainer');
        const hiddenInput = wc.querySelector('#bankName');
        if(!container) return;
        container.innerHTML = banks.map(b =>
          '<div class="bank-item" data-name="'+b.name+'" data-code="'+b.code+'" style="padding:12px 14px;color:#fff;font-size:14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);">'+b.name+'</div>'
        ).join('');
        container.querySelectorAll('.bank-item').forEach(item=>{
          item.addEventListener('click', ()=>{
            const wc2 = document.getElementById('walletContent');
            const bs = wc2.querySelector('#bankSearch');
            const sd = wc2.querySelector('#selectedBankDisplay');
            if(hiddenInput) hiddenInput.value = item.dataset.code;
            if(bs) bs.value = item.dataset.name;
            container.style.display = 'none';
            if(sd){ sd.style.display='block'; sd.textContent='✅ '+item.dataset.name; }
            const wc3 = document.getElementById('walletContent');
            const accInput = wc3 ? wc3.querySelector('#bankAccount') : null;
            if(accInput && accInput.value.length >= 10) accInput.dispatchEvent(new Event('input'));
          });
        });
      };
        fetch(serverURL+'/api/wallet/banklist?cc='+cc).then(r=>r.json()).then(data=>{
          console.log('banklist response:', JSON.stringify(data).substring(0,100));
          if(data.success && data.banks && data.banks.length){ loadBankList(data.banks); }
          else { loadBankList([]); }
        }).catch((e)=>{ console.log('banklist error:', e.message); loadBankList([]); });
      // Fix touch scrolling on contact list
      const scList = c.querySelector('#contactScrollList');
      if(scList){
        let startY=0, startScroll=0;
        scList.addEventListener('touchstart', e=>{ startY=e.touches[0].clientY; startScroll=scList.scrollTop; e.stopPropagation(); }, {passive:true});
        scList.addEventListener('touchmove', e=>{ const dy=startY-e.touches[0].clientY; scList.scrollTop=startScroll+dy; e.stopPropagation(); }, {passive:true});
      }
      let sCont=null,aTab='contact';
      c.querySelectorAll('.send-tab').forEach(b=>b.addEventListener('click',()=>{
        try{
          aTab=b.dataset.tab;
          c.querySelectorAll('.send-tab').forEach(x=>{x.style.background='var(--bg-secondary,#111e2e)';x.style.border='1px solid rgba(255,255,255,0.1)';});
          b.style.background='#00B0A0';b.style.border='none';
          const contactTab=c.querySelector('#sendContactTab');
          const bankTab=c.querySelector('#sendBankTab');
          if(contactTab) contactTab.style.display=aTab==='contact'?'block':'none';
          if(bankTab) bankTab.style.display=aTab==='bank'?'block':'none';
        }catch(e){console.error('Tab switch error:',e);}
      }));
      // Bank search functionality
    const bankSearch = c.querySelector('#bankSearch');
    const bankListContainer = c.querySelector('#bankListContainer');
    const bankNameInput = c.querySelector('#bankName');
    const selectedBankDisplay = c.querySelector('#selectedBankDisplay');
    if(bankSearch && bankListContainer){
      bankSearch.addEventListener('input', function(){
        const q = this.value.toLowerCase();
        bankListContainer.querySelectorAll('.bank-item').forEach(item=>{
          item.style.display = item.dataset.name.toLowerCase().includes(q) ? '' : 'none';
        });
      });
      bankListContainer.addEventListener('click', function(e){
        const item = e.target.closest('.bank-item');
        if(!item) return;
        const name = item.dataset.name;
        const code = item.dataset.code;
        bankNameInput.value = code;
        bankSearch.value = name;
        bankListContainer.style.display = 'none';
        if(selectedBankDisplay){ selectedBankDisplay.style.display='block'; selectedBankDisplay.textContent='✅ '+name; }
        // Trigger account resolve if account number already entered
        const accInput = c.querySelector('#bankAccount');
        if(accInput && accInput.value.length >= 10) accInput.dispatchEvent(new Event('input'));
      });
      bankSearch.addEventListener('focus', ()=>{ bankListContainer.style.display=''; });
    }

    // Show region verification notice
    const verifyNotice = c.querySelector('#verifyNotice');
    const ngSupported = ['NG','GH','KE','ZA','TZ','UG','ZM','RW','ET'].includes(cc);
    if(verifyNotice){
      if(ngSupported){
        verifyNotice.textContent = '✅ Account name verification supported for your region';
        verifyNotice.style.color = '#00B0A0';
      } else {
        verifyNotice.textContent = 'ℹ️ Verification not available for your region — you can still send money';
        verifyNotice.style.color = '#f0a500';
      }
    }
    // Auto-resolve bank account name
    let resolveTimer = null;
    c.querySelector('#bankAccount')?.addEventListener('input', function() {
      clearTimeout(resolveTimer);
      const accNum = this.value.trim();
      console.log('Account input fired, length:', accNum.length);
      const bankCode = c.querySelector('#bankName')?.value;
      const resolvedEl = c.querySelector('#resolvedName');
      if (!resolvedEl) return;
      if (accNum.length < 10) { resolvedEl.textContent = 'Enter account number to verify'; resolvedEl.style.color = '#7a9bb5'; return; }
      resolvedEl.textContent = 'Verifying...'; resolvedEl.style.color = '#7a9bb5';
      resolveTimer = setTimeout(() => {
        fetch(serverURL+'/api/wallet/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_number: accNum, account_bank: getBankCode(bankCode), currency: WALLET_CONFIG.currency })
        }).then(r=>r.json()).then(data=>{
          if(data.success){
            resolvedEl.textContent = '✅ ' + data.account_name;
            resolvedEl.style.color = '#00B0A0';
            c.querySelector('#bankAccName') && (c.querySelector('#bankAccName').value = data.account_name);
          } else {
            const ngnSupported = ['NG','GH','KE','ZA','TZ','UG','ZM','RW','ET'].includes(cc);
            if(ngnSupported){
              resolvedEl.textContent = '⚠️ Verification temporarily unavailable — please confirm account details manually';
              resolvedEl.style.color = '#ff6464';
            } else {
              resolvedEl.textContent = '⚠️ Verification not available for your region — you can still send money';
              resolvedEl.style.color = '#f0a500';
            }
          }
        }).catch(()=>{ resolvedEl.textContent = '⚠️ Could not verify — check your connection'; resolvedEl.style.color = '#f0a500'; });
      }, 800);
    });
    c.querySelector('#bankName')?.addEventListener('change', () => {
      const accInput = c.querySelector('#bankAccount');
      if(accInput && accInput.value.length >= 10) accInput.dispatchEvent(new Event('input'));
    });
    c.querySelectorAll('.send-contact-btn').forEach(b=>b.addEventListener('click',()=>{sCont={id:b.dataset.id,name:b.dataset.name};c.querySelectorAll('.send-contact-btn').forEach(x=>x.style.borderColor='rgba(255,255,255,0.08)');b.style.borderColor='#00B0A0';const disp=c.querySelector('#selContactDisplay');if(disp){disp.style.display='block';disp.textContent='✅ Selected: '+sCont.name;}}));
      c.querySelector('#sendMoneyBtn')?.addEventListener('click',()=>{const amt=parseFloat(c.querySelector('#sendAmount')?.value);if(!amt||amt<1){showNotification('Enter amount');return;}if(aTab==='contact'){
            if(!sCont){showNotification('Select a contact');return;}
            if(amt>_balance){showNotification('Insufficient balance');return;}
            fetch(serverURL+'/api/wallet/p2p',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({senderId:USER?.xameId,recipientId:sCont.id,amount:amt,currency:WALLET_CONFIG.currency})
            }).then(r=>r.json()).then(res=>{
              if(res.success){ loadWallet(); showNotification('✅ Sent '+fmt(amt)+' to '+sCont.name+(res.fee?' (fee: '+fmt(res.fee)+')':'')); }
              else { showNotification('❌ '+(res.message||'Transfer failed')); }
            }).catch(()=>showNotification('❌ Network error'));
            return;
          }else{const bk=c.querySelector('#bankName')?.value,ba=c.querySelector('#bankAccount')?.value,bn=c.querySelector('#bankAccName')?.value;if(!ba||!bn){showNotification('Fill all bank details');return;}
          if(amt > _balance){showNotification('Insufficient balance');return;}
          showNotification('Processing transfer...');
          fetch(serverURL+'/api/wallet/send-bank',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({account_bank:getBankCode(bk),account_number:ba,amount:amt,currency:WALLET_CONFIG.currency,narration:'XamePay Transfer to '+bn,accName:bn,userId:USER?.xameId})
          }).then(r=>r.json()).then(data=>{
            if(data.success){
              loadWallet();
              showNotification('✅ Transfer successful! Fee: '+fmt(data.fee||0));
              renderS('home');
            } else { showNotification('Transfer failed: '+(data.message||'Unknown error')); }
          }).catch(()=>showNotification('Transfer error'));}});
    }
    if(screen==='load')c.querySelectorAll('.load-method-btn').forEach(b=>b.addEventListener('click',()=>showLoadDetail(b.dataset.method)));
  }

  function showSett(){
    document.getElementById('wSD')?.remove();
    const dlg=document.createElement('div');dlg.id='wSD';
    dlg.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    dlg.innerHTML='<div style="background:var(--bg-secondary,#111e2e);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;max-height:85vh;overflow-y:auto;">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;"><h3 style="font-size:17px;font-weight:700;color:#fff;">&#9881;&#65039; Wallet Settings</h3><button id="wSC" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">&#10005;</button></div>'
      
      
      +'<div style="margin-bottom:20px;"><div style="font-size:13px;font-weight:700;color:#7a9bb5;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">&#127758; Country</div>'
      +'<select id="wCo" style="width:100%;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;">'
      +Object.entries(GD).map(([code,d])=>'<option value="'+code+'"'+(WALLET_CONFIG.currency===code?' selected':'')+'>'+d.country+' ('+code+')</option>').join('')
      +'</select></div>'
      +'<div style="margin-bottom:24px;"><div style="font-size:13px;font-weight:700;color:#7a9bb5;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">Currency</div>'
      +'<select id="wCu" style="width:100%;background:var(--bg-primary,#0d1520);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;">'
      +Object.keys(GD).map(c=>'<option value="'+c+'"'+(WALLET_CONFIG.currency===c?' selected':'')+'>'+c+'</option>').join('')
      +'</select></div>'
      
      
      
      +'<div style="border-top:1px solid rgba(255,255,255,0.08);margin:20px 0;padding-top:20px;">'
      +'<div style="font-size:11px;font-weight:700;color:#7a9bb5;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">SECURITY</div>'
      +'<button id="wPinSetup" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:space-between;">'
      +'<span>💰 Wallet PIN</span><span id="wPinStatus" style="color:#00B0A0;font-size:13px;">OFF ›</span></button>'
      +'</div>'
      +'<button id="wSS" style="width:100%;background:linear-gradient(135deg,#00B0A0,#008A7D);border:none;border-radius:14px;padding:16px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">Save Settings</button>'
      +'</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#wSC').addEventListener('click',()=>dlg.remove());
    const pinStatusEl = dlg.querySelector('#wPinStatus');
    if (pinStatusEl && typeof walletLock !== 'undefined') pinStatusEl.textContent = walletLock.isEnabled() ? 'ON ›' : 'OFF ›';
    dlg.querySelector('#wPinSetup')?.addEventListener('click',()=>{ dlg.remove(); if(typeof walletLock!=='undefined') walletLock.showSetupDialog(); });
    dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.remove();});
    
    dlg.querySelector('#wSS').addEventListener('click',()=>{
      WALLET_CONFIG.testMode = false;
      WALLET_CONFIG.currency=dlg.querySelector('#wCo').value;
      persistentStorage.set('wallet:currency',WALLET_CONFIG.currency);
      fetch(serverURL+'/api/wallet/currency',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:USER?.xameId,currency:WALLET_CONFIG.currency})}).catch(()=>{});
      persistentStorage.set('wallet:provider',WALLET_CONFIG.defaultProvider);

      showNotification('Wallet settings saved!');
      dlg.remove();renderS('home');
    });
  }

  function _credit(amount, fromName) {
    // Reload from server to get accurate balance
    loadWallet();
    if (document.getElementById('walletOverlay')) renderS('home');
  }

  _init();
  return { show, isConfigured, _credit, _init };
})();
