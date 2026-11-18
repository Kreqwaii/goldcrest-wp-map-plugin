/* Goldcrest WordPress Plugin Workbench Controller (Tabs, WP Admin Sync Simulator & PHP Viewer) */
(function () {
  'use strict';

  const tabButtons = document.querySelectorAll('.wb-tab[data-tab]');
  const tabPanels = document.querySelectorAll('.wb-panel[data-panel]');

  function activateTab(tabId) {
    tabButtons.forEach((btn) => {
      const active = btn.dataset.tab === tabId;
      btn.setAttribute('aria-selected', String(active));
      btn.classList.toggle('is-active', active);
    });
    tabPanels.forEach((panel) => {
      const active = panel.dataset.panel === tabId;
      panel.hidden = !active;
    });
    if (tabId === 'preview' && window.GC_MARKET_MAP) {
      requestAnimationFrame(() => {
        window.GC_MARKET_MAP.invalidateSize();
      });
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  // Keep header telemetry synced with live map state
  const statBadge = document.getElementById('wbLiveStats');
  window.addEventListener('gc-map-updated', (e) => {
    if (!statBadge || !e.detail) return;
    const d = e.detail;
    statBadge.textContent = `${d.goldcrest} Goldcrest · ${d.other} Market · z${d.zoom}`;
  });

  // Preview quick-test buttons
  const btnZoom13 = document.getElementById('wbTestZoom13');
  const btnFitUk = document.getElementById('wbResetUk');
  const btnSampleEnq = document.getElementById('wbTestEnquiry');

  if (btnZoom13) {
    btnZoom13.addEventListener('click', () => {
      if (window.GC_MARKET_MAP) window.GC_MARKET_MAP.setZoom(13);
    });
  }
  if (btnFitUk) {
    btnFitUk.addEventListener('click', () => {
      if (window.GC_MARKET_MAP) window.GC_MARKET_MAP.fitUK();
    });
  }
  if (btnSampleEnq) {
    btnSampleEnq.addEventListener('click', () => {
      if (window.GC_MARKET_MAP) window.GC_MARKET_MAP.openSampleEnquiry();
    });
  }

  // ---- Tab 2: WP Admin Settings + Google Sheets + Property CPT Sync ----
  const cfgInputs = {
    osApiKey: document.getElementById('cfgOsKey'),
    osStyle: document.getElementById('cfgOsStyle'),
    osMaxNativeZoom: document.getElementById('cfgOsMaxZoom'),
    esriApiKey: document.getElementById('cfgEsriKey'),
    otherMaxZoom: document.getElementById('cfgOtherMaxZoom'),
    sheetsUrl: document.getElementById('cfgSheetsUrl'),
    syncSchedule: document.getElementById('cfgSyncSchedule'),
    cptSync: document.getElementById('cfgCptSync'),
    recipientEmail: document.getElementById('cfgRecipientEmail'),
    mailchimpAudienceId: document.getElementById('cfgMcAudience'),
    mailchimpTag: document.getElementById('cfgMcTag')
  };

  const cfgPreviewEl = document.getElementById('wpLocalizedPreview');
  const syncStatusEl = document.getElementById('wpSyncStatus');
  const syncOutputEl = document.getElementById('wpSyncOutput');

  function readFormConfig() {
    return {
      osApiKey: cfgInputs.osApiKey ? cfgInputs.osApiKey.value.trim() : '',
      osStyle: cfgInputs.osStyle ? cfgInputs.osStyle.value : 'Light_3857',
      osMaxNativeZoom: cfgInputs.osMaxNativeZoom ? Number(cfgInputs.osMaxNativeZoom.value) || 16 : 16,
      esriApiKey: cfgInputs.esriApiKey ? cfgInputs.esriApiKey.value.trim() : '',
      otherMaxZoom: cfgInputs.otherMaxZoom ? Number(cfgInputs.otherMaxZoom.value) || 12 : 12,
      enquiryEndpoint: '/wp-json/goldcrest-map/v1/enquiry',
      restNonce: 'wp_rest_demo_nonce_8f42a1',
      recipientEmail: cfgInputs.recipientEmail ? cfgInputs.recipientEmail.value.trim() : 'office@goldcrestlfg.com',
      mailchimpAudienceId: cfgInputs.mailchimpAudienceId ? cfgInputs.mailchimpAudienceId.value.trim() : 'a8f39c12e4',
      mailchimpTag: cfgInputs.mailchimpTag ? cfgInputs.mailchimpTag.value.trim() : 'Buyer Inquiry',
      demoMode: true
    };
  }

  function refreshLocalizedPreview() {
    if (!cfgPreviewEl) return;
    const cfg = readFormConfig();
    const wpObject = {
      osApiKey: cfg.osApiKey ? '***configured***' : '',
      osStyle: cfg.osStyle,
      osMaxNativeZoom: cfg.osMaxNativeZoom,
      esriApiKey: cfg.esriApiKey ? '***configured***' : '',
      otherMaxZoom: cfg.otherMaxZoom,
      enquiryEndpoint: 'https://goldcrestlfg.com/wp-json/goldcrest-map/v1/enquiry',
      restNonce: cfg.restNonce,
      recipientEmail: cfg.recipientEmail,
      mailchimpAudienceId: cfg.mailchimpAudienceId,
      mailchimpTag: cfg.mailchimpTag,
      sheetTabName: 'Map (public)',
      cptSyncEnabled: cfgInputs.cptSync ? cfgInputs.cptSync.checked : true,
      cronSchedule: cfgInputs.syncSchedule ? cfgInputs.syncSchedule.value : 'daily'
    };
    cfgPreviewEl.textContent = `wp_localize_script('gc-market-map', 'GC_MAP_CONFIG', ${JSON.stringify(wpObject, null, 2)});`;
  }

  Object.values(cfgInputs).forEach((el) => {
    if (!el) return;
    el.addEventListener('input', refreshLocalizedPreview);
    el.addEventListener('change', refreshLocalizedPreview);
  });
  refreshLocalizedPreview();

  const btnApplySettings = document.getElementById('wpApplySettings');
  if (btnApplySettings) {
    btnApplySettings.addEventListener('click', () => {
      const next = readFormConfig();
      if (window.GC_MARKET_MAP) {
        window.GC_MARKET_MAP.applyConfig(next);
      }
      if (syncStatusEl) {
        syncStatusEl.textContent = `Settings applied to Live Preview (otherMaxZoom: ${next.otherMaxZoom}, osStyle: ${next.osStyle}, recipient: ${next.recipientEmail})`;
        syncStatusEl.hidden = false;
      }
    });
  }

  // Populate live 14 Goldcrest Property CPT table from window.GC_PTS
  const cptTableBody = document.getElementById('cptPinsTableBody');
  const pts = Array.isArray(window.GC_PTS) ? window.GC_PTS : [];
  const goldPins = pts.filter((p) => p.pin === 'Goldcrest');
  const otherPins = pts.filter((p) => p.pin !== 'Goldcrest');

  if (cptTableBody) {
    cptTableBody.innerHTML = goldPins.map((p) => `
      <tr>
        <td><strong>${escapeText(p.name)}</strong></td>
        <td><span class="wp-badge wp-badge-gold">Goldcrest</span></td>
        <td>${escapeText(p.region)}</td>
        <td class="num">${Number(p.ha || 0).toFixed(2)} ha</td>
        <td class="num">${escapeText(p.guide)}</td>
        <td class="num mono">${Number(p.lat).toFixed(5)}, ${Number(p.lon).toFixed(5)}</td>
        <td><a href="${escapeText(p.link)}" target="_blank" rel="noopener">goldcrestlfg.com</a></td>
      </tr>
    `).join('');
  }

  const btnRunSync = document.getElementById('wpRunSyncBtn');
  if (btnRunSync) {
    btnRunSync.addEventListener('click', () => {
      const cptOn = cfgInputs.cptSync ? cfgInputs.cptSync.checked : true;
      const sheetUrl = cfgInputs.sheetsUrl ? cfgInputs.sheetsUrl.value.trim() : '';
      const schedule = cfgInputs.syncSchedule ? cfgInputs.syncSchedule.value : 'daily';
      const totalHa = pts.reduce((acc, p) => acc + (Number(p.ha) || 0), 0);
      const samplePayload = {
        syncedAt: new Date().toISOString(),
        sourceSheetTab: 'Map (public)',
        sheetEndpoint: sheetUrl,
        cronSchedule: schedule,
        cptMergeEnabled: cptOn,
        counts: {
          totalActiveForSale: pts.length,
          goldcrestListings: goldPins.length,
          widerMarketApproxPins: otherPins.length,
          skippedUnderOfferOrSold: 0,
          totalHectares: Math.round(totalHa * 10) / 10
        },
        sampleNormalizedRecords: [
          goldPins[0] || null,
          otherPins[0] || null
        ].filter(Boolean)
      };

      if (syncStatusEl) {
        syncStatusEl.textContent = `Sync completed: ${pts.length} active properties cached (${goldPins.length} Goldcrest CPT, ${otherPins.length} Wider market)`;
        syncStatusEl.hidden = false;
      }
      if (syncOutputEl) {
        syncOutputEl.textContent = JSON.stringify(samplePayload, null, 2);
      }
    });
  }

  // ---- Tab 3: WordPress Plugin PHP Code Viewer ----
  const phpCodeEl = document.getElementById('phpCodeView');
  const phpStatsEl = document.getElementById('phpFileStats');
  const copyPhpBtn = document.getElementById('copyPhpBtn');
  const phpSource = typeof window.GC_PLUGIN_PHP_SOURCE === 'string' ? window.GC_PLUGIN_PHP_SOURCE : '';

  if (phpCodeEl && phpSource) {
    phpCodeEl.textContent = phpSource;
    if (phpStatsEl) {
      const lines = phpSource.split('\n').length;
      const kb = (new Blob([phpSource]).size / 1024).toFixed(1);
      phpStatsEl.textContent = `${lines} lines · ${kb} KB · PHP 8.0+`;
    }
  }

  if (copyPhpBtn && phpSource) {
    copyPhpBtn.addEventListener('click', () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(phpSource).then(() => {
          copyPhpBtn.textContent = 'Copied to clipboard';
          setTimeout(() => { copyPhpBtn.textContent = 'Copy PHP Source'; }, 1800);
        }).catch(() => {});
      }
    });
  }

  function escapeText(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
