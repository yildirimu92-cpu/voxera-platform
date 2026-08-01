import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(path, 'utf8');
const paths = {
  syncCoordinator: 'admin-panel/netlify/functions/trigger-elevenlabs-sync-v2.js',
  syncStatus: 'admin-panel/netlify/functions/elevenlabs-sync-status.js',
  scrapeCoordinator: 'admin-panel/netlify/functions/scrape-website-v2.js',
  syncRuntime: 'admin-panel/shared/admin-runtime-sync.js',
  launchRuntime: 'admin-panel/shared/admin-runtime-launch-p0.js',
  loader: 'admin-panel/shared/offer-brand.js'
};

const source = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, read(path)]));
let failed = 0;

for (const [key, path] of Object.entries(paths)) {
  try {
    new vm.Script(source[key], { filename:path });
    console.log(`PASS syntax ${path}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL syntax ${path}: ${error.message}`);
  }
}

async function verifyWebsiteWizardMerge() {
  const elements = {
    'wz-website-url': { value:'https://voxera-test.example', disabled:false },
    'wz-scrape-btn': { disabled:false },
    'wz-scrape-feedback': { textContent:'', style:{} }
  };
  const generic = {
    businessDescription:'Generisches Profil',
    services:'Generische Leistungen',
    locationHours:'Generische Erreichbarkeit',
    bookingFaq:'Generische Terminlogik',
    instructions:'Generische Regeln',
    fallbackEscalation:'Generische Eskalation',
    responseConstraints:'Generische Grenzen',
    extraSteps:[]
  };
  const garage = {
    businessDescription:'Garage Vorlage',
    services:'Garage Vorlage Leistungen',
    locationHours:'Garage Vorlage Zeiten',
    bookingFaq:'Garage Terminlogik',
    instructions:'Garage Regeln',
    fallbackEscalation:'Garage Eskalation',
    responseConstraints:'Garage Grenzen',
    extraSteps:[{ id:'garage', fields:[{ key:'pannendienst', type:'radio', options:[{ val:'yes' }] }] }]
  };
  const restaurant = {
    ...garage,
    businessDescription:'Restaurant Vorlage',
    services:'Restaurant Vorlage Leistungen',
    bookingFaq:'Restaurant Terminlogik',
    instructions:'Restaurant Regeln',
    extraSteps:[]
  };
  let scrapePayload = {
    success:true,
    source_url:'https://voxera-test.example/',
    data:{
      company_name:'Voxera Test AG',
      short_description:'Individuelles Profil der Website',
      services:'Individuelle Leistungen der Website',
      location_hours:'Luzern, Montag bis Freitag',
      language:'de',
      industry_guess:'garage'
    }
  };
  let renderCount = 0;
  const state = {
    aiConfigs:{ customer_1:{} },
    aiWizard:{
      customerId:'customer_1',
      step:0,
      data:{
        templateId:'generic',
        businessDescription:generic.businessDescription,
        services:generic.services,
        locationHours:generic.locationHours,
        bookingFaq:generic.bookingFaq,
        instructions:generic.instructions,
        fallbackEscalation:generic.fallbackEscalation,
        responseConstraints:generic.responseConstraints,
        shortDescription:'',
        websiteUrl:'',
        language:'de',
        customerType:'company',
        _customerDisplayName:'Voxera Test AG'
      },
      steps:[]
    }
  };
  const templates = { generic, garage, restaurant };
  const makeSteps = templateId => [
    { id:'website', collect:() => {} },
    { id:'branche', collect:data => { data.templateId = templateId; } },
    { id:'profil', collect:() => {} }
  ];
  state.aiWizard.steps = makeSteps('garage');

  const context = {
    console,
    state,
    document:{
      readyState:'complete',
      getElementById:id => elements[id] || null
    },
    setTimeout:fn => { fn(); return 1; },
    clearTimeout:() => {},
    callAdminFunction:async () => scrapePayload,
    wizardScrapeWebsite:async () => {},
    wizardNext:async () => {
      const wizard = state.aiWizard;
      wizard.steps[wizard.step]?.collect(wizard.data);
      if (wizard.step < wizard.steps.length - 1) wizard.step += 1;
    },
    getTemplateDefaults:id => templates[id] || generic,
    getWizardSteps:id => makeSteps(id),
    renderWizardModal:() => { renderCount += 1; },
    customerById:() => ({ id:'customer_1', name:'Voxera Test AG' })
  };
  vm.createContext(context);
  vm.runInContext(source.launchRuntime, context);

  await context.wizardScrapeWebsite();
  const data = state.aiWizard.data;
  const expected = {
    businessDescription:'Individuelles Profil der Website',
    shortDescription:'Individuelles Profil der Website',
    services:'Individuelle Leistungen der Website',
    locationHours:'Luzern, Montag bis Freitag',
    templateId:'garage',
    bookingFaq:'Garage Terminlogik',
    instructions:'Garage Regeln',
    fallbackEscalation:'Garage Eskalation',
    responseConstraints:'Garage Grenzen',
    pannendienst:'yes'
  };
  for (const [field, value] of Object.entries(expected)) {
    if (data[field] !== value) throw new Error(`website merge mismatch for ${field}: ${data[field]}`);
  }
  if (renderCount < 1 || !elements['wz-scrape-feedback'].textContent.includes('Angaben übernommen')) {
    throw new Error('website merge feedback/render missing');
  }

  data.services = 'Manuell angepasste Leistungen';
  scrapePayload = {
    ...scrapePayload,
    data:{ ...scrapePayload.data, services:'Zweiter Website-Wert', industry_guess:'garage' }
  };
  await context.wizardScrapeWebsite();
  if (data.services !== 'Manuell angepasste Leistungen') {
    throw new Error('manual wizard value was overwritten by a repeated scrape');
  }

  state.aiWizard.step = 1;
  state.aiWizard.steps = makeSteps('restaurant');
  await context.wizardNext();
  if (data.templateId !== 'restaurant' || data.bookingFaq !== 'Restaurant Terminlogik' || data.instructions !== 'Restaurant Regeln') {
    throw new Error('branch step did not rebase untouched template defaults');
  }
  if (data.businessDescription !== 'Individuelles Profil der Website' || data.services !== 'Manuell angepasste Leistungen') {
    throw new Error('branch step overwrote website or manual values');
  }
}

try {
  await verifyWebsiteWizardMerge();
  console.log('PASS website defaults merge, repeated scrape protection and branch transition');
} catch (error) {
  failed += 1;
  console.error('FAIL website wizard behavior: ' + error.message);
}

const checks = [
  ['sync coordinator authenticates admin', /requireAdminCaller/.test(source.syncCoordinator) && /requiredCapability: 'customer:write'/.test(source.syncCoordinator)],
  ['sync coordinator derives stored agent id', /customer\.elevenlabs_agent_id/.test(source.syncCoordinator) && /agent_mismatch/.test(source.syncCoordinator)],
  ['sync coordinator has bounded timeout', /SYNC_TIMEOUT_MS = 24_000/.test(source.syncCoordinator) && /AbortController/.test(source.syncCoordinator)],
  ['sync coordinator records failed timeout state', /setSyncState\(sb, customerId, 'failed'/.test(source.syncCoordinator) && /sync_timeout/.test(source.syncCoordinator)],
  ['sync status is server-side and authenticated', /requiredCapability: 'customer:write'/.test(source.syncStatus) && /elevenlabs_sync_log/.test(source.syncStatus)],
  ['sync runtime no longer queries sync log directly', /elevenlabs-sync-status/.test(source.syncRuntime) && !/authClient\.from\('elevenlabs_sync_log'\)/.test(source.syncRuntime)],
  ['sync runtime exposes manual retry', /Jetzt synchronisieren/.test(source.syncRuntime) && /trigger-elevenlabs-sync/.test(source.syncRuntime)],
  ['website coordinator retries scheme safely', /https:\/\//.test(source.scrapeCoordinator) && /http:\/\//.test(source.scrapeCoordinator) && /FALLBACK_CODES/.test(source.scrapeCoordinator)],
  ['launch runtime routes stable endpoints', /trigger-elevenlabs-sync-v2/.test(source.launchRuntime) && /scrape-website-v2/.test(source.launchRuntime)],
  ['website defaults are replaceable but persisted values are protected', /canReplaceWizardValue/.test(source.launchRuntime) && /config\.businessDescription/.test(source.launchRuntime) && /_scrapedValues/.test(source.launchRuntime)],
  ['detected and manually selected templates rebase untouched defaults', /rebaseWizardTemplate/.test(source.launchRuntime) && /installWizardTemplateTransition/.test(source.launchRuntime)],
  ['website feedback survives wizard rerender', /renderWizardModal/.test(source.launchRuntime) && /setWebsiteFeedback\(message, true\)/.test(source.launchRuntime)],
  ['launch runtime is loaded last', /admin-runtime-launch-p0\.js/.test(source.loader) && source.loader.indexOf('admin-runtime-launch-p0.js') > source.loader.indexOf('admin-runtime-sync.js')]
];

for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) {
  console.error(`Launch sync/website verification failed: ${failed}`);
  process.exit(1);
}
console.log(`Launch sync/website verification passed: ${checks.length} checks.`);
