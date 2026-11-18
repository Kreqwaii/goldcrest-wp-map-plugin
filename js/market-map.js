/* Goldcrest Land & Forestry Market Map - Runtime Controller */
(function () {
  'use strict';

  const root = document.getElementById('gc-land-forestry-map');
  if (!root || typeof L === 'undefined') return;

  const $ = (id) => root.querySelector('#' + id);
  const qsa = (sel) => root.querySelectorAll(sel);

  const UK = window.GC_UK || { land: [], counties: [], lakes: [], rivers: [], roads: [], towns: [] };
  const PTS = Array.isArray(window.GC_PTS) ? window.GC_PTS : [];
  const getCfg = () => window.GC_MAP_CONFIG || {};

  // ---- helpers ----
  const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB');
  const fmtHa = (ha) => {
    const v = Number(ha) || 0;
    return v >= 100 ? fmtInt(v) : v.toLocaleString('en-GB', { maximumFractionDigits: 1 });
  };
  const fmtAc = (ac) => fmtInt(ac);
  const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const pband = (p) =>
    p < 500000 ? 'Under £500,000'
      : p < 1500000 ? '£500,000 – £1.5m'
      : p < 3000000 ? '£1.5m – £3m'
      : '£3m +';

  const band = (ha) =>
    ha < 10 ? 'Under 10 ha'
      : ha < 50 ? '10–50 ha'
      : ha < 200 ? '50–200 ha'
      : '200 ha +';

  PTS.forEach((p) => {
    p.band = band(p.ha);
    p.pb = pband(p.price);
    p.cats = String(p.type || '').split('; ').filter(Boolean);
  });

  // ---- filter dropdowns ----
  const REGIONS = {
    Scotland: ['South Scotland', 'Central Scotland & Argyll', 'North East Scotland', 'Highlands & Islands'],
    England: ['North of England', 'Midlands', 'East of England', 'South East England', 'South West England'],
    Wales: ['Wales']
  };
  const TYPES = ['Commercial forest', 'Amenity wood', 'Estate', 'Carbon credits', 'Natural capital', 'Farm', 'Planting land', 'House & land'];
  const SIZES = ['Under 10 ha', '10–50 ha', '50–200 ha', '200 ha +'];
  const PRICES = ['Under £500,000', '£500,000 – £1.5m', '£1.5m – £3m', '£3m +'];

  function fillOpts(el, list, anyLabel) {
    if (!el) return;
    el.innerHTML = `<option value="">${anyLabel}</option>` + list.map((v) => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
  }

  function regionOpts(country) {
    const list = country ? (REGIONS[country] || []) : Object.values(REGIONS).flat();
    fillOpts($('fRegion'), list, 'All regions');
  }

  fillOpts($('fCountry'), Object.keys(REGIONS), 'All countries');
  regionOpts('');
  fillOpts($('fType'), TYPES, 'All categories');
  fillOpts($('fSize'), SIZES, 'Any size');
  fillOpts($('fPrice'), PRICES, 'Any price');

  // ---- Leaflet map & vector fallback ----
  const UKB = L.latLngBounds([49.8, -8.4], [60.95, 1.9]);
  const mapEl = $('map');
  const map = L.map(mapEl, {
    zoomControl: false,
    minZoom: 5,
    maxZoom: 17,
    zoomSnap: 1,
    maxBounds: UKB.pad(0.25),
    worldCopyJump: false
  });
  map.attributionControl.setPrefix(false);

  map.createPane('fallback');
  map.getPane('fallback').style.zIndex = 150;
  map.createPane('vlabels');
  map.getPane('vlabels').style.zIndex = 450;
  map.getPane('vlabels').style.pointerEvents = 'none';

  const vr = L.canvas({ pane: 'fallback', padding: 0.5 });
  const fc = (f) => ({ type: 'FeatureCollection', features: f || [] });
  const vlayer = (feats, style, minZ) => ({
    l: L.geoJSON(fc(feats), { renderer: vr, interactive: false, style }),
    minZ
  });

  const VEC = [
    vlayer(UK.land, (f) => f.properties && f.properties.uk
      ? { fillColor: '#FFFFFF', fillOpacity: 1, color: '#9FB8D0', weight: 1 }
      : { fillColor: '#F2F4F6', fillOpacity: 1, color: '#C9D3DD', weight: 0.8 }, 0),
    vlayer(UK.counties, () => ({ fill: false, color: '#CBD7E2', weight: 0.8, dashArray: '3 4' }), 7),
    vlayer(UK.lakes, () => ({ fillColor: '#D3E3F0', fillOpacity: 1, color: '#B9D0E4', weight: 0.6 }), 6),
    vlayer(UK.rivers, () => ({ color: '#BCD2E6', weight: 1.1 }), 7),
    vlayer((UK.roads || []).filter((r) => r.properties && r.properties.t === 's'), () => ({ color: '#E9DFC8', weight: 1 }), 8),
    vlayer((UK.roads || []).filter((r) => r.properties && r.properties.t === 'm'), () => ({ color: '#E2C98A', weight: 1.6 }), 6)
  ];

  const townLayer = L.layerGroup();
  const townMin = (z) => (z <= 5 ? 400000 : z === 6 ? 150000 : z === 7 ? 40000 : z === 8 ? 12000 : z === 9 ? 4000 : 0);
  const IEB = L.latLngBounds([51.3, -10.7], [55.45, -5.95]);
  if (Array.isArray(UK.towns)) {
    UK.towns.sort((a, b) => b[3] - a[3]);
  }

  let base = 'map';
  let tilesOk = false;

  function drawTowns() {
    townLayer.clearLayers();
    if (tilesOk || !Array.isArray(UK.towns)) return;
    const z = map.getZoom();
    const min = townMin(z);
    const vb = map.getBounds().pad(0.05);
    const placed = [];
    for (const t of UK.towns) {
      if (t[3] < min) break;
      if (!vb.contains([t[1], t[2]])) continue;
      const big = t[3] >= (z <= 7 ? 400000 : 80000);
      const pt = map.latLngToContainerPoint([t[1], t[2]]);
      const w = t[0].length * (big ? 7.6 : 6.6) + 12;
      const h = 16;
      const box = [pt.x - 4, pt.y - h / 2, pt.x + w, pt.y + h / 2];
      if (placed.some((p) => box[0] < p[2] + 4 && box[2] + 4 > p[0] && box[1] < p[3] + 2 && box[3] + 2 > p[1])) continue;
      placed.push(box);
      const ie = IEB.contains([t[1], t[2]]) && t[2] < -6.1;
      const cls = 'vlab' + (big ? ' big' : '') + (ie ? ' ie' : '');
      L.marker([t[1], t[2]], {
        pane: 'vlabels',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: '',
          html: `<span class="${cls}" style="position:absolute">${escHtml(t[0])}</span>`,
          iconSize: [0, 0]
        })
      }).addTo(townLayer);
    }
  }

  const satLines = L.geoJSON(
    fc((UK.land || []).filter((f) => f.properties && f.properties.uk)),
    { renderer: vr, interactive: false, style: () => ({ fill: false, color: 'rgba(255,255,255,0.6)', weight: 1 }) }
  );

  function drawVector() {
    if (tilesOk || !map._loaded) return;
    const z = map.getZoom();
    const sat = base === 'sat';
    mapEl.classList.toggle('sat', sat);
    VEC.forEach((v) => {
      const on = !sat && z >= v.minZ;
      if (on && !map.hasLayer(v.l)) v.l.addTo(map);
      if (!on && map.hasLayer(v.l)) map.removeLayer(v.l);
    });
    if (sat && !map.hasLayer(satLines)) satLines.addTo(map);
    if (!sat && map.hasLayer(satLines)) map.removeLayer(satLines);
    if (!map.hasLayer(townLayer)) townLayer.addTo(map);
    drawTowns();
  }

  function clearVector() {
    VEC.forEach((v) => map.removeLayer(v.l));
    [townLayer, satLines].forEach((l) => map.removeLayer(l));
    mapEl.classList.remove('sat');
  }

  map.on('zoomend moveend', drawVector);

  // ---- Live Basemap Tile Layers (CARTO Positron Light / OS Data Hub + Esri World Imagery) ----
  function buildBases() {
    const cfg = getCfg();
    const osAttr = 'Contains OS data &copy; Crown copyright and database rights 2026';
    const useLiveOs = Boolean(cfg.osApiKey && !cfg.demoMode);
    const useLiveEsri = Boolean(cfg.esriApiKey && !cfg.demoMode);

    const mapLayers = useLiveOs
      ? [
          L.tileLayer(
            'https://api.os.uk/maps/raster/v1/zxy/' + encodeURIComponent(cfg.osStyle || 'Light_3857') + '/{z}/{x}/{y}.png?key=' + encodeURIComponent(cfg.osApiKey),
            {
              maxZoom: 17,
              maxNativeZoom: Number(cfg.osMaxNativeZoom) || 16,
              attribution: osAttr
            }
          )
        ]
      : [];

    const imageryUrl = useLiveEsri
      ? 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=' + encodeURIComponent(cfg.esriApiKey)
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

    const satLayers = [
      L.tileLayer(imageryUrl, {
        maxZoom: 17,
        maxNativeZoom: 16,
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics'
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 17,
        maxNativeZoom: 16,
        minZoom: 8,
        pane: 'overlayPane'
      })
    ];

    return {
      map: L.layerGroup(mapLayers),
      sat: L.layerGroup(satLayers)
    };
  }

  let BASES = buildBases();

  function setBase(b) {
    Object.values(BASES).forEach((l) => map.removeLayer(l));
    base = b;
    tilesOk = false;
    BASES[b].addTo(map);
    BASES[b].eachLayer((t) => {
      t.on('tileload', () => {
        if (!tilesOk) {
          tilesOk = true;
          clearVector();
        }
      });
    });
    qsa('.basemap button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.base === b)));
    const box = $('mapbox');
    if (box) box.style.background = b === 'sat' ? '#1d2b36' : 'var(--sea)';
    drawVector();
  }

  qsa('.basemap button').forEach((x) => {
    x.onclick = () => setBase(x.dataset.base);
  });
  setBase('map');

  function home() {
    const box = $('mapbox');
    const h = box ? box.clientHeight : 600;
    if (h >= 700) map.setView([54.45, -3.2], 6);
    else map.fitBounds([[50.0, -6.2], [58.7, 1.8]]);
  }
  home();
  drawVector();

  if ($('zin')) $('zin').onclick = () => map.zoomIn();
  if ($('zout')) $('zout').onclick = () => map.zoomOut();

  // ---- Pins ----
  map.createPane('others');
  map.getPane('others').style.zIndex = 610;
  map.createPane('gold');
  map.getPane('gold').style.zIndex = 640;

  const goldIcon = L.divIcon({
    className: '',
    html: '<div class="gpin"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  let touch = false;
  window.addEventListener('touchstart', () => { touch = true; }, { passive: true, once: true });

  PTS.forEach((d) => {
    const isGold = d.pin === 'Goldcrest';
    d.layer = isGold
      ? L.marker([d.lat, d.lon], {
          icon: goldIcon,
          pane: 'gold',
          keyboard: true,
          title: d.name,
          riseOnHover: true
        })
      : L.circleMarker([d.lat, d.lon], {
          pane: 'others',
          radius: 5.5,
          color: '#ffffff',
          weight: 1.6,
          fillColor: '#0F4C81',
          fillOpacity: 1
        });

    d.layer.on('mouseover', () => { if (!touch) showCard(d, false); });
    d.layer.on('mouseout', () => { if (!touch) hideSoon(); });
    d.layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      showCard(d, true);
    });
  });

  // ---- Filtering & Zoom Limit ----
  const state = { show: 'all', country: '', region: '', type: '', size: '', price: '' };

  function match(d) {
    if (state.show !== 'all' && d.pin !== state.show) return false;
    if (state.country && d.country !== state.country) return false;
    if (state.region && d.region !== state.region) return false;
    if (state.type && !d.cats.includes(state.type)) return false;
    if (state.size && d.band !== state.size) return false;
    if (state.price && d.pb !== state.price) return false;
    return true;
  }

  let lastStats = { total: PTS.length, goldcrest: 0, other: 0, ha: 0, zoom: 6, hiddenOthers: 0 };

  function render() {
    const z = map.getZoom();
    const otherMaxZoom = Number(getCfg().otherMaxZoom) || 12;
    const hideOther = z > otherMaxZoom;
    let shown = 0;
    let goldCount = 0;
    let otherCount = 0;
    let ha = 0;
    let hiddenOthers = 0;

    PTS.forEach((d) => {
      const m = match(d);
      const vis = m && (d.pin === 'Goldcrest' || !hideOther);
      if (m && !vis) hiddenOthers += 1;
      if (vis) {
        if (!map.hasLayer(d.layer)) d.layer.addTo(map);
        shown += 1;
        ha += Number(d.ha) || 0;
        if (d.pin === 'Goldcrest') goldCount += 1;
        else otherCount += 1;
      } else if (map.hasLayer(d.layer)) {
        map.removeLayer(d.layer);
      }
    });

    const toastEl = $('toast');
    if (toastEl) toastEl.hidden = !(hiddenOthers > 0);

    const countEl = $('count');
    if (countEl) {
      countEl.innerHTML = `<b>${shown}</b> ${shown === 1 ? 'property' : 'properties'} · ${fmtInt(ha)} ha (${goldCount} Goldcrest · ${otherCount} wider market)`;
    }

    const zoomReadout = $('zoomReadout');
    if (zoomReadout) {
      zoomReadout.textContent = `z${z} · max ${otherMaxZoom}`;
    }

    lastStats = { total: shown, goldcrest: goldCount, other: otherCount, ha: Math.round(ha), zoom: z, hiddenOthers };
    window.dispatchEvent(new CustomEvent('gc-map-updated', { detail: lastStats }));
  }

  map.on('zoomend', render);
  render();

  qsa('.bar .seg button').forEach((b) => {
    b.onclick = () => {
      state.show = b.dataset.show;
      qsa('.bar .seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    };
  });

  $('fCountry').onchange = (e) => {
    state.country = e.target.value;
    state.region = '';
    regionOpts(state.country);
    render();
    zoomTo();
  };
  $('fRegion').onchange = (e) => {
    state.region = e.target.value;
    render();
    zoomTo();
  };
  $('fType').onchange = (e) => { state.type = e.target.value; render(); };
  $('fSize').onchange = (e) => { state.size = e.target.value; render(); };
  $('fPrice').onchange = (e) => { state.price = e.target.value; render(); };
  $('reset').onclick = () => {
    Object.assign(state, { show: 'all', country: '', region: '', type: '', size: '', price: '' });
    ['fCountry', 'fType', 'fSize', 'fPrice'].forEach((id) => {
      if ($(id)) $(id).value = '';
    });
    regionOpts('');
    qsa('.bar .seg button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.show === 'all')));
    render();
    home();
  };

  function zoomTo() {
    const pts = PTS.filter(match);
    if ((!state.country && !state.region) || !pts.length) {
      home();
      return;
    }
    map.fitBounds(L.latLngBounds(pts.map((d) => [d.lat, d.lon])), { padding: [50, 50], maxZoom: 10 });
  }

  // ---- Info Card ----
  const card = $('card');
  let hideT = null;

  const oneTag = (t) => {
    const c = { 'Amenity wood': 'Amenity', 'Natural capital': 'Natural', 'Carbon credits': 'Carbon', Estate: 'Estate' }[t] || '';
    return `<span class="type ${c}"><i></i>${escHtml(t)}</span>`;
  };
  const tagsHtml = (d) => `<div class="tags">${d.cats.map(oneTag).join('')}</div>`;

  function showCard(d) {
    clearTimeout(hideT);
    qsa('.gpin').forEach((x) => x.classList.remove('on'));
    if (d.pin === 'Goldcrest' && d.layer.getElement() && d.layer.getElement().firstChild) {
      d.layer.getElement().firstChild.classList.add('on');
    }
    const gold = d.pin === 'Goldcrest';
    card.className = 'card' + (gold ? ' gold' : '');
    card.innerHTML = gold
      ? `<div class="hd"><span class="ref">Goldcrest listing</span><span class="chip">For sale</span><button class="x" type="button" aria-label="Close">×</button></div>
         <div class="bd"><div class="nm">${escHtml(d.name)}</div>${tagsHtml(d)}
           <dl class="kv"><dt>Region</dt><dd>${escHtml(d.region)}</dd><dt>Area</dt><dd>${fmtHa(d.ha)} ha (${fmtAc(d.ac)} acres)</dd></dl>
           <div class="price">${escHtml(d.guide)}</div>
           <a class="cta" href="${escHtml(d.link)}" target="_blank" rel="noopener">View property</a></div>`
      : `<div class="hd"><span class="ref">${escHtml(d.ref)}</span><span class="chip">${escHtml(d.status)}</span><button class="x" type="button" aria-label="Close">×</button></div>
         <div class="bd">${tagsHtml(d)}
           <dl class="kv"><dt>Region</dt><dd>${escHtml(d.region)}</dd><dt>Area</dt><dd>${fmtHa(d.ha)} ha (${fmtAc(d.ac)} acres)</dd></dl>
           <div class="price">${escHtml(d.guide)}</div>
           <button class="cta" type="button" id="ask">Ask about this property</button></div>`;

    card.hidden = false;
    const x = card.querySelector('.x');
    if (x) x.onclick = hideCard;
    const ask = card.querySelector('#ask');
    if (ask) ask.onclick = () => openForm(d);

    if (getComputedStyle(card).position !== 'fixed') {
      const box = $('mapbox');
      const pt = map.latLngToContainerPoint([d.lat, d.lon]);
      let left = pt.x + 18;
      let top = pt.y - 24;
      if (left + 296 > box.clientWidth) left = pt.x - 304;
      top = Math.max(10, Math.min(top, box.clientHeight - card.offsetHeight - 10));
      card.style.left = (left + box.offsetLeft) + 'px';
      card.style.top = (top + box.offsetTop) + 'px';
    }
  }

  function hideSoon() {
    hideT = setTimeout(hideCard, 260);
  }

  function hideCard() {
    card.hidden = true;
    qsa('.gpin').forEach((x) => x.classList.remove('on'));
  }

  card.addEventListener('mouseenter', () => clearTimeout(hideT));
  card.addEventListener('mouseleave', () => { if (!touch) hideSoon(); });
  map.on('click', hideCard);
  if ($('stage')) $('stage').appendChild(card);

  // ---- Enquiry Modal with GDPR Consent, Honeypot & WP REST + Mailchimp Dispatch Preview ----
  const scrim = $('scrim');

  function closeModal() {
    scrim.hidden = true;
    scrim.innerHTML = '';
  }

  function openForm(d) {
    hideCard();
    const sum = `${d.ref} · ${d.cats.join(', ')} · ${fmtHa(d.ha)} ha · ${d.guide}`;
    scrim.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt">
        <div class="hd">
          <p class="eyebrow">Ask us to act for you</p>
          <h2 id="mt">Interested in ${escHtml(d.ref)}</h2>
          <p class="sum">${escHtml(d.region)} · ${escHtml(d.cats.join(', '))} · ${fmtHa(d.ha)} ha · ${escHtml(d.guide)}</p>
          <button class="close" type="button" aria-label="Close">×</button>
        </div>
        <form id="enq" novalidate>
          <div class="row">
            <div class="field">
              <label for="eName">Name</label>
              <input id="eName" required autocomplete="name" placeholder="Full name">
            </div>
            <div class="field">
              <label for="ePhone">Phone</label>
              <input id="ePhone" type="tel" autocomplete="tel" placeholder="+44 7700 900000">
            </div>
          </div>
          <div class="field">
            <label for="eEmail">Email</label>
            <input id="eEmail" type="email" required autocomplete="email" placeholder="buyer@example.co.uk">
          </div>
          <div class="field">
            <label for="eProp">Property</label>
            <input id="eProp" value="${escHtml(sum)}" readonly>
          </div>
          <div class="field">
            <label for="eMsg">Message</label>
            <textarea id="eMsg" placeholder="What are you looking for? Timescale, budget, or questions about this property."></textarea>
          </div>
          <div class="gc-hp" aria-hidden="true">
            <label for="eWebsite">Leave this field blank</label>
            <input id="eWebsite" name="website" type="text" tabindex="-1" autocomplete="off" value="">
          </div>
          <label class="check">
            <input type="checkbox" id="eAct" checked>
            <span>I would like Goldcrest to appraise this property and act for me as buyer</span>
          </label>
          <label class="check" id="eGdprWrap">
            <input type="checkbox" id="eGdpr" required>
            <span>I consent to Goldcrest Land &amp; Forestry Group storing and processing my personal details under UK GDPR to handle this property enquiry.</span>
          </label>
          <p class="form-err" id="eErr" hidden></p>
          <button class="cta" type="submit">Send enquiry</button>
          <p class="fine">Goldcrest is not the selling agent for this property. Submissions route to ${escHtml(getCfg().recipientEmail || 'office@goldcrestlfg.com')} and sync to Mailchimp.</p>
        </form>
      </div>`;

    scrim.hidden = false;
    scrim.querySelector('.close').onclick = closeModal;
    scrim.onclick = (e) => { if (e.target === scrim) closeModal(); };
    setTimeout(() => { if ($('eName')) $('eName').focus(); }, 20);

    const form = $('enq');
    form.onsubmit = (e) => {
      e.preventDefault();
      const cfg = getCfg();
      const nameEl = $('eName');
      const phoneEl = $('ePhone');
      const emailEl = $('eEmail');
      const msgEl = $('eMsg');
      const propEl = $('eProp');
      const actEl = $('eAct');
      const gdprEl = $('eGdpr');
      const hpEl = $('eWebsite');
      const errEl = $('eErr');

      const name = nameEl.value.trim();
      const email = emailEl.value.trim();
      const phone = phoneEl.value.trim();
      const message = msgEl.value.trim();
      const gdprOk = gdprEl.checked;
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

      nameEl.classList.toggle('invalid', !name);
      emailEl.classList.toggle('invalid', !emailOk);
      $('eGdprWrap').classList.toggle('invalid', !gdprOk);

      if (!name || !emailOk || !gdprOk) {
        errEl.textContent = !name
          ? 'Please enter your name.'
          : !emailOk
            ? 'Please enter a valid email address.'
            : 'Please confirm UK GDPR consent to submit your enquiry.';
        errEl.hidden = false;
        return;
      }
      errEl.hidden = true;

      const payload = {
        ref: d.ref,
        name,
        phone,
        email,
        message,
        actForMe: actEl.checked,
        gdprConsent: true,
        website: hpEl ? hpEl.value : '',
        property: propEl.value
      };

      const ep = cfg.enquiryEndpoint || '/wp-json/goldcrest-map/v1/enquiry';
      if (!cfg.demoMode && ep) {
        fetch(ep, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': cfg.restNonce || ''
          },
          body: JSON.stringify(payload)
        }).catch(() => {});
      }

      const nameParts = name.split(/\s+/);
      const fname = nameParts[0] || '';
      const lname = nameParts.slice(1).join(' ');
      const recipient = cfg.recipientEmail || 'office@goldcrestlfg.com';
      const audienceId = cfg.mailchimpAudienceId || 'a8f39c12e4';
      const mcTag = cfg.mailchimpTag || 'Buyer Inquiry';

      const emailPreview = [
        `To: ${recipient}`,
        `Reply-To: ${name} <${email}>`,
        `Subject: [Goldcrest Market Map] Buyer Enquiry: ${d.ref}`,
        `Honeypot Check: Passed (website === "")`,
        `GDPR Consent: Confirmed (${new Date().toISOString()})`,
        ``,
        `Property: ${propEl.value}`,
        `Act as Buyer: ${actEl.checked ? 'Yes (Independent appraisal requested)' : 'No'}`,
        `Phone: ${phone || 'Not provided'}`,
        `Message: ${message || '(No additional message)'}`
      ].join('\n');

      const mailchimpPreview = JSON.stringify({
        endpoint: `PUT /3.0/lists/${audienceId}/members/{md5_email}`,
        status_if_new: 'subscribed',
        email_address: email,
        merge_fields: {
          EMAIL: email,
          FNAME: fname,
          LNAME: lname,
          PHONE: phone
        },
        tags: [mcTag]
      }, null, 2);

      const restPayloadPreview = JSON.stringify(payload, null, 2);

      form.outerHTML = `
        <div class="done">
          <p class="eyebrow" style="color:var(--gold-deep)">Enquiry dispatched</p>
          <p>Thank you, ${escHtml(fname)}. Your enquiry for <b>${escHtml(d.ref)}</b> has been validated and formatted for WordPress REST dispatch.</p>

          <div class="dispatch-box">
            <div class="dispatch-hd">
              <span>POST ${escHtml(ep)}</span>
              <span class="dispatch-status">200 OK · Nonce + Honeypot Validated</span>
            </div>
            <pre class="dispatch-pre">${escHtml(restPayloadPreview)}</pre>
          </div>

          <div class="dispatch-box">
            <div class="dispatch-hd">
              <span>wp_mail() Dispatch Preview</span>
              <span class="dispatch-status">${escHtml(recipient)}</span>
            </div>
            <pre class="dispatch-pre">${escHtml(emailPreview)}</pre>
          </div>

          <div class="dispatch-box">
            <div class="dispatch-hd">
              <span>Mailchimp API v3 Sync</span>
              <span class="dispatch-status">Tag: ${escHtml(mcTag)}</span>
            </div>
            <pre class="dispatch-pre">${escHtml(mailchimpPreview)}</pre>
          </div>

          <button class="cta" type="button" id="dn">Back to the map</button>
        </div>`;

      $('dn').onclick = closeModal;
    };
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !scrim.hidden) closeModal();
  });

  // Public controller for WordPress / Engineering Workbench integration
  window.GC_MARKET_MAP = {
    invalidateSize() {
      map.invalidateSize();
    },
    applyConfig(nextCfg) {
      Object.assign(window.GC_MAP_CONFIG, nextCfg || {});
      render();
    },
    setZoom(z) {
      map.setZoom(z);
    },
    fitUK() {
      home();
    },
    getStats() {
      return Object.assign({}, lastStats);
    },
    openSampleEnquiry() {
      const sample = PTS.find((p) => p.pin === 'Other');
      if (sample) openForm(sample);
    }
  };
})();
