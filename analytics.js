/* ════════════════════════════════════════════════════════════════════
   ANALYTICS  —  Jacob Collier fan site
   Sdílený soubor pro všech 6 stránek. Dvě věci:
     1) PostHog  → soukromé statistiky (kdo, odkud, jak dlouho poslouchá)
     2) Supabase → veřejné počítadlo návštěv v patičce
   ════════════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────────
   KONFIGURACE  —  jediné, co musíš upravit: vlož PostHog klíč níže.
   ────────────────────────────────────────────────────────────────── */
var ANALYTICS = {
  // 1) SEM VLOŽ SVŮJ POSTHOG PROJECT KEY (začíná na phc_)
  //    Dokud sem nevložíš reálný klíč začínající "phc_", PostHog se vůbec nespustí.
  posthogKey: 'PASTE_POSTHOG_KEY_HERE',
  posthogHost: 'https://eu.i.posthog.com',   // EU servery (GDPR)

  // 2) Supabase počítadlo — už zapojeno, není třeba sahat
  supabaseUrl: 'https://mvqpmurbiybtczulcnlm.supabase.co',
  supabaseKey: 'sb_publishable_5Z3E5NvFDKoXF9WSbpxybA_Ik0-yrS1'
};

/* ──────────────────────────────────────────────────────────────────
   PostHog loader (oficiální snippet). Nic se nenačte, dokud níže
   nezavoláme posthog.init() — a to uděláme jen s reálným klíčem.
   ────────────────────────────────────────────────────────────────── */
!function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init os ds Ie us vs ss ls capture calculateEventProperties register register_once register_for_session unregister unregister_for_session ws getFeatureFlag getFeatureFlagPayload getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty bs ps createPersonProfile setInternalOrTestUser ys es $s opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing cs debug M gs getPageViewId captureTraceFeedback captureTraceMetric Qr".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

/* Zapneme PostHog jen když je vložený reálný klíč (phc_…). */
/* Lokální vývoj a testy (localhost, file://, headless prohlížeče) se nepočítají:
   jinak by každé spuštění testu zvedlo veřejné počítadlo návštěv. */
var IS_LOCAL = location.protocol === 'file:' ||
  /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$|\.local$|\.test$|\.localhost$/.test(location.hostname) ||
  navigator.webdriver === true || /HeadlessChrome/.test(navigator.userAgent);

var PH_ON = !IS_LOCAL && (ANALYTICS.posthogKey || '').slice(0, 4) === 'phc_';
if (PH_ON) {
  posthog.init(ANALYTICS.posthogKey, {
    api_host: ANALYTICS.posthogHost,
    defaults: '2026-01-30',
    cookieless_mode: 'always'   // bez cookies → kvůli PostHogu nepotřebuješ cookie lištu
  });
}

/* Bezpečné poslání události — když PostHog není zapnutý, tiše nic nedělá. */
function track(event, props) {
  if (!PH_ON) return;
  try { posthog.capture(event, props || {}); } catch (e) {}
}

/* ──────────────────────────────────────────────────────────────────
   MĚŘENÍ POSLECHU HUDBY
   Čteme jen veřejné API SongPlayeru (isPlaying / currentSongId) zvenčí —
   nulový zásah do existujícího kódu. Zachytí start, přepnutí,
   přirozený konec i odchod ze stránky.
   ────────────────────────────────────────────────────────────────── */
function songTitle(id) {
  try { return (typeof SONGS !== 'undefined' && SONGS[id]) ? SONGS[id].title : id; }
  catch (e) { return id; }
}

function initMusicTracking() {
  if (typeof SongPlayer === 'undefined' || !SongPlayer) return; // jen na stránce s přehrávačem
  var prevId = null, startedAt = 0;

  function finish(reason) {
    if (prevId === null) return;
    track('song_finish', {
      song_id: prevId,
      song_title: songTitle(prevId),
      seconds_played: Math.round((Date.now() - startedAt) / 1000),
      reason: reason || 'ended'
    });
  }

  setInterval(function () {
    var playing = SongPlayer.isPlaying();
    var id = playing ? SongPlayer.currentSongId() : null;
    if (id === prevId) return;            // beze změny
    finish('switch_or_end');              // dohrála/přepnula předchozí
    if (id !== null) {                    // začala nová
      startedAt = Date.now();
      track('song_play', { song_id: id, song_title: songTitle(id) });
    }
    prevId = id;
  }, 1000);

  // Odchod ze stránky během přehrávání → ať nepřijdeme o délku poslechu
  window.addEventListener('pagehide', function () { finish('page_leave'); });
}

/* Další signály zapojení (jen na stránce, kde ty prvky existují). */
function initEngagementTracking() {
  var gate = document.getElementById('gateBtn');
  if (gate) gate.addEventListener('click', function () { track('studio_entered'); });

  var rec = document.getElementById('recBtn');
  if (rec) rec.addEventListener('click', function () { track('recording_clicked'); });
}

/* ──────────────────────────────────────────────────────────────────
   VEŘEJNÉ POČÍTADLO NÁVŠTĚV  (Supabase)
   Jednou za návštěvu (per záložka) zvýší číslo, jinak jen přečte.
   Číslo vloží na konec patičky.
   ────────────────────────────────────────────────────────────────── */
function rpc(name) {
  return fetch(ANALYTICS.supabaseUrl + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      'apikey': ANALYTICS.supabaseKey,
      'Authorization': 'Bearer ' + ANALYTICS.supabaseKey,
      'Content-Type': 'application/json'
    },
    body: '{}'
  }).then(function (r) { return r.json(); });
}

function renderCount(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return;
  var footer = document.querySelector('footer');
  if (!footer) return;
  var el = document.getElementById('jcVisitCount');
  if (!el) {
    el = document.createElement('div');
    el.id = 'jcVisitCount';
    el.style.cssText = 'text-align:center;opacity:.65;font-size:.82em;margin-top:12px;letter-spacing:.02em;';
    footer.appendChild(el);
  }
  el.textContent = 'Počet návštěv: ' + Number(n).toLocaleString('cs-CZ');
}

function initCounter() {
  var KEY = 'jc_visited_session';
  var counted = false;
  try { counted = sessionStorage.getItem(KEY) === '1'; } catch (e) {}
  var fn = (counted || IS_LOCAL) ? 'jc_get_visits' : 'jc_bump_visits';   // lokálně jen čteme
  if (!counted) { try { sessionStorage.setItem(KEY, '1'); } catch (e) {} }
  rpc(fn).then(renderCount).catch(function () {});
}

/* ──────────────────────────────────────────────────────────────────
   START
   ────────────────────────────────────────────────────────────────── */
function initAnalytics() {
  initCounter();          // počítadlo běží vždy (nezávisle na PostHogu)
  if (PH_ON) {            // měření chování jen když je PostHog zapnutý
    initMusicTracking();
    initEngagementTracking();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAnalytics);
} else {
  initAnalytics();
}
