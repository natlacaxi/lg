/* =====================================================================
   BANK.JS — extensions de la démo Liquid Glass
   Dépend de scripts.js (SurfaceEquations, Spring, state, updateFilter,
   calculateDisplacementMap1D/2D, calculateSpecularHighlight,
   imageDataToDataURL, startAnimationLoop, updateContentClonePosition…)
   ---------------------------------------------------------------------
   1. Utilitaires (DOM, toast, cache de cartes de déplacement)
   2. Fabrique de filtres SVG
   3. Fabrique de curseurs en verre        -> createGlassSlider
   4. Fabrique d'interrupteurs en verre    -> createGlassSwitch
   5. Presets de la lentille (boutons en ligne)
   6. Banque de curseurs (lentille, couleurs, dégradés, formes, surfaces)
   7. Banque d'interrupteurs
   8. Banque de curseurs souris (CSS + SVG personnalisés)
   9. Télémétrie + export
  10. Navigation + démarrage
   ===================================================================== */

(function () {
  "use strict";

  /* ===================================================================
     1. UTILITAIRES
     =================================================================== */

  const SVG_NS = "http://www.w3.org/2000/svg";
  let uid = 0;
  const registry = { sliders: [], switches: [] };

  function h(tag, className, style, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (style) Object.assign(node.style, style);
    if (parent) parent.appendChild(node);
    return node;
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let toastEl = null;
  let toastTimer = null;
  function toast(message) {
    if (!toastEl) {
      toastEl = h("div", "toast", null, document.body);
      toastEl.setAttribute("role", "status");
    }
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 1800);
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage || "Copié dans le presse-papiers");
    } catch (err) {
      // Repli : textarea temporaire
      const ta = h("textarea", null, { position: "fixed", opacity: "0" }, document.body);
      ta.value = text;
      ta.select();
      try {
        document.execCommand("copy");
        toast(okMessage || "Copié dans le presse-papiers");
      } catch (e2) {
        toast("Copie impossible");
      }
      ta.remove();
    }
  }

  // Cache : évite de recalculer les cartes pour des configs identiques
  const mapCache = new Map();
  function getMaps(w, hgt, r, bezel, thickness, n, surface) {
    const key = [w, hgt, r, bezel, thickness, n, surface].join("|");
    if (mapCache.has(key)) return mapCache.get(key);
    const pre = calculateDisplacementMap1D(
      thickness,
      bezel,
      SurfaceEquations[surface],
      n,
    );
    const maxD = Math.max(...pre.map(Math.abs)) || 1;
    const disp = calculateDisplacementMap2D(w, hgt, w, hgt, r, bezel, maxD, pre);
    const spec = calculateSpecularHighlight(w, hgt, r, bezel);
    const result = {
      disp: imageDataToDataURL(disp),
      spec: imageDataToDataURL(spec),
      maxD,
    };
    mapCache.set(key, result);
    return result;
  }

  /* ===================================================================
     2. FABRIQUE DE FILTRES SVG
     =================================================================== */

  function buildFilter(id, w, hgt, maps, o) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "glass-filter-svg");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "width:0;height:0;position:absolute";
    svg.innerHTML = `
      <defs>
        <filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"
                color-interpolation-filters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="${o.blur}" result="blurred_source" />
          <feImage href="${maps.disp}" x="0" y="0" width="${w}" height="${hgt}"
                   result="displacement_map" preserveAspectRatio="none" />
          <feDisplacementMap in="blurred_source" in2="displacement_map"
                   scale="${maps.maxD * o.refraction}"
                   xChannelSelector="R" yChannelSelector="G" result="displaced" />
          <feColorMatrix in="displaced" type="saturate" values="${o.saturation}"
                   result="displaced_saturated" />
          <feImage href="${maps.spec}" x="0" y="0" width="${w}" height="${hgt}"
                   result="specular_layer" preserveAspectRatio="none" />
          <feComposite in="displaced_saturated" in2="specular_layer" operator="in"
                   result="specular_saturated" />
          <feComponentTransfer in="specular_layer" result="specular_faded">
            <feFuncA type="linear" slope="${o.specular}" />
          </feComponentTransfer>
          <feBlend in="specular_saturated" in2="displaced" mode="normal"
                   result="withSaturation" />
          <feBlend in="specular_faded" in2="withSaturation" mode="normal" />
        </filter>
      </defs>`;
    return {
      svg,
      blur: svg.querySelector("feGaussianBlur"),
      displacement: svg.querySelector("feDisplacementMap"),
      saturation: svg.querySelector("feColorMatrix"),
      specAlpha: svg.querySelector("feFuncA"),
    };
  }

  /* ===================================================================
     3. FABRIQUE DE CURSEURS EN VERRE
     =================================================================== */

  const DEFAULT_SLIDER = {
    label: "Curseur",
    note: "",
    min: 0,
    max: 100,
    step: 1,
    value: 50,
    unit: "",
    decimals: 0,
    format: null,
    fillColor: "#0377f7",
    trackColor: "#89898f66",
    trackBackground: null,
    thumbW: 90,
    thumbH: 60,
    thumbR: 30,
    trackW: 300,
    trackH: 14,
    bezel: 16,
    thickness: 80,
    n: 1.45,
    surface: "convex_squircle",
    restScale: 0.6,
    dragScale: 1,
    specular: 0.4,
    saturation: 7,
    blur: 0,
    refraction: 1,
    areaH: 110,
    onChange: null,
  };

  function createGlassSlider(parent, options) {
    const o = Object.assign({}, DEFAULT_SLIDER, options);
    const id = "bankSlider" + ++uid;
    const trackTop = (o.thumbH - o.trackH) / 2;
    const restW = o.thumbW * o.restScale;

    const fmt =
      o.format ||
      ((v) => (o.decimals ? v.toFixed(o.decimals) : String(Math.round(v))) + o.unit);

    /* --- DOM --- */
    const card = h("div", "bank-card", null, parent);
    const head = h("div", "bank-card-head", null, card);
    const title = h("span", "bank-card-title", null, head);
    title.textContent = o.label;
    const valueEl = h("span", "bank-card-value", null, head);

    const area = h("div", "bank-area", { height: o.areaH + "px" }, card);
    const box = h(
      "div",
      "bank-slider",
      { width: o.trackW + "px", height: o.thumbH + "px" },
      area,
    );

    const trackStyle = {
      top: trackTop + "px",
      width: o.trackW + "px",
      height: o.trackH + "px",
      borderRadius: o.trackH / 2 + "px",
    };
    const track = h("div", "bank-track", trackStyle, box);
    if (o.trackBackground) track.style.background = o.trackBackground;
    else track.style.backgroundColor = o.trackColor;

    const trackInner = h(
      "div",
      "bank-track-inner",
      { borderRadius: o.trackH / 2 + "px" },
      track,
    );
    const fill = h("div", "bank-fill", { borderRadius: o.trackH / 2 - 1 + "px" }, trackInner);
    if (o.fillColor) fill.style.backgroundColor = o.fillColor;
    else fill.style.display = "none";

    const thumb = h(
      "div",
      "bank-thumb",
      {
        width: o.thumbW + "px",
        height: o.thumbH + "px",
        borderRadius: o.thumbR + "px",
        transform: `scale(${o.restScale})`,
      },
      box,
    );
    thumb.tabIndex = 0;
    thumb.setAttribute("role", "slider");
    thumb.setAttribute("aria-label", o.label);
    thumb.setAttribute("aria-valuemin", String(o.min));
    thumb.setAttribute("aria-valuemax", String(o.max));

    const clone = h("div", "bank-thumb-clone", null, thumb);
    const cloneInner = h("div", "bank-thumb-clone-inner", null, clone);
    const cloneTrack = h(
      "div",
      "bank-clone-track",
      {
        width: o.trackW + "px",
        height: o.trackH + "px",
        borderRadius: o.trackH / 2 + "px",
      },
      cloneInner,
    );
    if (o.trackBackground) cloneTrack.style.background = o.trackBackground;
    else cloneTrack.style.backgroundColor = o.trackColor;
    const cloneFill = h(
      "div",
      "bank-clone-fill",
      { borderRadius: o.trackH / 2 - 1 + "px" },
      cloneTrack,
    );
    if (o.fillColor) cloneFill.style.backgroundColor = o.fillColor;
    else cloneFill.style.display = "none";

    const maps = getMaps(o.thumbW, o.thumbH, o.thumbR, o.bezel, o.thickness, o.n, o.surface);
    const filter = buildFilter(id + "Filter", o.thumbW, o.thumbH, maps, o);
    thumb.appendChild(filter.svg);
    clone.style.filter = `url(#${id}Filter)`;
    h("div", "bank-thumb-inner", null, thumb);

    if (o.note) {
      const note = h("div", "bank-card-note", null, card);
      note.textContent = o.note;
    }

    /* --- État --- */
    let value = clamp(o.value, o.min, o.max);
    let pct = ((value - o.min) / (o.max - o.min)) * 100;
    let pointerDown = false;
    let forceActive = false;
    let thumbX = 0;
    let raf = null;
    let flashTimer = null;

    const springs = {
      scale: new Spring(o.restScale, 2000, 80),
      bg: new Spring(1, 2000, 80),
      ratio: new Spring(0.4 * o.refraction, 100, 10),
    };

    const pctToValue = (p) => {
      const raw = o.min + (p / 100) * (o.max - o.min);
      const snapped = Math.round(raw / o.step) * o.step;
      return clamp(+snapped.toFixed(6), o.min, o.max);
    };
    const valueToPct = (v) => ((v - o.min) / (o.max - o.min)) * 100;

    function updateUI() {
      fill.style.width = pct + "%";
      cloneFill.style.width = pct + "%";

      const ratio = pct / 100;
      const x0 = restW / 2;
      const x100 = o.trackW - restW / 2;
      const centerX = x0 + ratio * (x100 - x0);
      thumbX = centerX - o.thumbW / 2;
      thumb.style.left = thumbX + "px";

      const a = area.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const containerLeft = b.left - a.left;
      const containerTop = b.top - a.top;

      cloneInner.style.width = a.width + "px";
      cloneInner.style.height = a.height + "px";
      cloneInner.style.transform = `translate(${-(containerLeft + thumbX)}px, ${-containerTop}px)`;
      cloneTrack.style.left = containerLeft + "px";
      cloneTrack.style.top = containerTop + trackTop + "px";

      valueEl.textContent = fmt(value);
      thumb.setAttribute("aria-valuenow", String(value));
      thumb.setAttribute("aria-valuetext", fmt(value));
    }

    function frame() {
      const dt = 1 / 60;
      const active = forceActive || pointerDown;
      springs.scale.setTarget(active ? o.dragScale : o.restScale);
      springs.bg.setTarget(active ? 0.1 : 1);
      springs.ratio.setTarget((active ? 0.9 : 0.4) * o.refraction);

      const s = springs.scale.update(dt);
      const bg = springs.bg.update(dt);
      const r = springs.ratio.update(dt);

      thumb.style.transform = `scale(${s})`;
      thumb.style.backgroundColor = `rgba(255, 255, 255, ${bg})`;

      const cloneOpacity = 1 - bg;
      clone.style.opacity = cloneOpacity;
      clone.style.display = cloneOpacity < 0.01 ? "none" : "block";

      filter.displacement.setAttribute("scale", maps.maxD * r);

      if (Object.values(springs).every((sp) => sp.isSettled())) raf = null;
      else raf = requestAnimationFrame(frame);
    }

    function start() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function commit(newPct, notify) {
      const newValue = pctToValue(clamp(newPct, 0, 100));
      const changed = newValue !== value;
      value = newValue;
      pct = valueToPct(value);
      updateUI();
      if (changed && notify && typeof o.onChange === "function") o.onChange(value, api);
    }

    function pointerToPct(clientX) {
      const r = track.getBoundingClientRect();
      const x0 = r.left + restW / 2;
      const x100 = r.right - restW / 2;
      return ((clientX - x0) / (x100 - x0)) * 100;
    }

    function onMove(ev) {
      if (!pointerDown) return;
      ev.preventDefault();
      commit(pointerToPct(ev.clientX), true);
    }

    function onUp() {
      pointerDown = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      start();
    }

    function onDown(ev) {
      ev.preventDefault();
      pointerDown = true;
      if (ev.currentTarget === track) commit(pointerToPct(ev.clientX), true);
      thumb.focus({ preventScroll: true });
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      start();
    }

    thumb.addEventListener("pointerdown", onDown);
    track.addEventListener("pointerdown", onDown);

    thumb.addEventListener("keydown", (ev) => {
      const big = (o.max - o.min) / 10;
      let next = null;
      switch (ev.key) {
        case "ArrowLeft":
        case "ArrowDown":
          next = value - o.step;
          break;
        case "ArrowRight":
        case "ArrowUp":
          next = value + o.step;
          break;
        case "PageDown":
          next = value - big;
          break;
        case "PageUp":
          next = value + big;
          break;
        case "Home":
          next = o.min;
          break;
        case "End":
          next = o.max;
          break;
        default:
          return;
      }
      ev.preventDefault();
      commit(valueToPct(clamp(next, o.min, o.max)), true);
      // Flash : on "active" brièvement le verre au clavier
      forceActive = true;
      start();
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        forceActive = false;
        start();
      }, 260);
    });

    window.addEventListener("resize", updateUI);

    const api = {
      card,
      thumb,
      options: o,
      getValue: () => value,
      setValue(v, silent) {
        value = pctToValue(valueToPct(clamp(v, o.min, o.max)));
        pct = valueToPct(value);
        updateUI();
        if (!silent && typeof o.onChange === "function") o.onChange(value, api);
      },
      setForceActive(flag) {
        forceActive = !!flag;
        start();
      },
      refresh: updateUI,
    };

    updateUI();
    start();
    registry.sliders.push(api);
    return api;
  }

  /* ===================================================================
     4. FABRIQUE D'INTERRUPTEURS EN VERRE
     =================================================================== */

  const DEFAULT_SWITCH = {
    label: "Interrupteur",
    note: "",
    checked: true,
    onColor: [59, 191, 78, 0.93],
    offColor: [148, 148, 159, 0.47],
    trackW: 160,
    trackH: 67,
    thumbW: 146,
    thumbH: 92,
    thumbR: 46,
    bezel: 19,
    thickness: 47,
    n: 1.5,
    surface: "convex_squircle",
    restScale: 0.65,
    activeScale: 0.9,
    specular: 0.5,
    saturation: 6,
    blur: 0.2,
    refraction: 1,
    areaH: 150,
    onChange: null,
  };

  function createGlassSwitch(parent, options) {
    const o = Object.assign({}, DEFAULT_SWITCH, options);
    const id = "bankSwitch" + ++uid;
    const restOffset = ((1 - o.restScale) * o.thumbW) / 2;
    const travel = o.trackW - o.trackH - (o.thumbW - o.thumbH) * o.restScale;
    const marginLeft = -restOffset + (o.trackH - o.thumbH * o.restScale) / 2;
    const thumbYOffset = o.trackH / 2 - o.thumbH / 2;

    /* --- DOM --- */
    const card = h("div", "bank-card", null, parent);
    const head = h("div", "bank-card-head", null, card);
    const title = h("span", "bank-card-title", null, head);
    title.textContent = o.label;
    const valueEl = h("span", "bank-card-value", null, head);

    const area = h("div", "bank-area", { height: o.areaH + "px" }, card);
    const box = h("div", "bank-switch-box", null, area);
    const track = h(
      "div",
      "bank-switch-track",
      {
        width: o.trackW + "px",
        height: o.trackH + "px",
        borderRadius: o.trackH / 2 + "px",
      },
      box,
    );

    const thumb = h(
      "div",
      "bank-switch-thumb",
      {
        width: o.thumbW + "px",
        height: o.thumbH + "px",
        borderRadius: o.thumbR + "px",
        top: o.trackH / 2 + "px",
        transform: `translateY(-50%) scale(${o.restScale})`,
      },
      track,
    );
    thumb.tabIndex = 0;
    thumb.setAttribute("role", "switch");
    thumb.setAttribute("aria-label", o.label);

    const clone = h("div", "bank-thumb-clone", null, thumb);
    const cloneInner = h("div", "bank-thumb-clone-inner", null, clone);
    const cloneTrack = h(
      "div",
      "bank-clone-track",
      {
        width: o.trackW + "px",
        height: o.trackH + "px",
        borderRadius: o.trackH / 2 + "px",
      },
      cloneInner,
    );

    const maps = getMaps(o.thumbW, o.thumbH, o.thumbR, o.bezel, o.thickness, o.n, o.surface);
    const filter = buildFilter(id + "Filter", o.thumbW, o.thumbH, maps, o);
    thumb.appendChild(filter.svg);
    clone.style.filter = `url(#${id}Filter)`;
    h("div", "bank-thumb-inner", null, thumb);

    if (o.note) {
      const note = h("div", "bank-card-note", null, card);
      note.textContent = o.note;
    }

    /* --- État --- */
    let checked = !!o.checked;
    let pointerDown = false;
    let forceActive = false;
    let initialX = 0;
    let xDrag = checked ? 1 : 0;
    let raf = null;

    const springs = {
      xRatio: new Spring(checked ? 1 : 0, 1000, 80),
      scale: new Spring(o.restScale, 2000, 80),
      bg: new Spring(1, 2000, 80),
      trackColor: new Spring(checked ? 1 : 0, 1000, 80),
      ratio: new Spring(0.4 * o.refraction, 100, 10),
    };

    function frame() {
      const dt = 1 / 60;
      const active = forceActive || pointerDown;

      springs.scale.setTarget(active ? o.activeScale : o.restScale);
      springs.bg.setTarget(active ? 0.1 : 1);
      springs.ratio.setTarget((active ? 0.9 : 0.4) * o.refraction);
      if (!pointerDown) springs.xRatio.setTarget(checked ? 1 : 0);

      const considerChecked = pointerDown ? (xDrag > 0.5 ? 1 : 0) : checked ? 1 : 0;
      springs.trackColor.setTarget(considerChecked);

      const xRatio = springs.xRatio.update(dt);
      const scale = springs.scale.update(dt);
      const bg = springs.bg.update(dt);
      const tc = springs.trackColor.update(dt);
      const ratio = springs.ratio.update(dt);

      const cloneOpacity = 1 - bg;
      clone.style.opacity = cloneOpacity;
      clone.style.display = cloneOpacity < 0.01 ? "none" : "block";

      const thumbX = marginLeft + xRatio * travel;
      thumb.style.left = thumbX + "px";
      thumb.style.transform = `translateY(-50%) scale(${scale})`;
      thumb.style.backgroundColor = `rgba(255, 255, 255, ${bg})`;
      thumb.style.boxShadow = pointerDown
        ? "0 4px 22px rgba(0,0,0,0.1), inset 2px 7px 24px rgba(0,0,0,0.09), inset -2px -7px 24px rgba(255,255,255,0.09)"
        : "0 4px 22px rgba(0,0,0,0.1)";

      const r = Math.round(o.offColor[0] + (o.onColor[0] - o.offColor[0]) * tc);
      const g = Math.round(o.offColor[1] + (o.onColor[1] - o.offColor[1]) * tc);
      const b = Math.round(o.offColor[2] + (o.onColor[2] - o.offColor[2]) * tc);
      const a = o.offColor[3] + (o.onColor[3] - o.offColor[3]) * tc;
      const color = `rgba(${r}, ${g}, ${b}, ${a})`;
      track.style.backgroundColor = color;
      cloneTrack.style.backgroundColor = color;

      const ar = area.getBoundingClientRect();
      const tr = track.getBoundingClientRect();
      const containerLeft = tr.left - ar.left;
      const containerTop = tr.top - ar.top;
      cloneInner.style.width = ar.width + "px";
      cloneInner.style.height = ar.height + "px";
      cloneInner.style.transform = `translate(${-(containerLeft + thumbX)}px, ${-(containerTop + thumbYOffset)}px)`;
      cloneTrack.style.left = containerLeft + "px";
      cloneTrack.style.top = containerTop + "px";

      filter.displacement.setAttribute("scale", maps.maxD * ratio);

      if (Object.values(springs).every((sp) => sp.isSettled())) raf = null;
      else raf = requestAnimationFrame(frame);
    }

    function start() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function setChecked(next, notify) {
      const changed = next !== checked;
      checked = next;
      valueEl.textContent = checked ? "ON" : "OFF";
      thumb.setAttribute("aria-checked", String(checked));
      start();
      if (changed && notify && typeof o.onChange === "function") o.onChange(checked, api);
    }

    function onMove(ev) {
      if (!pointerDown) return;
      const baseRatio = checked ? 1 : 0;
      const ratio = baseRatio + (ev.clientX - initialX) / travel;
      const overflow = ratio < 0 ? -ratio : ratio > 1 ? ratio - 1 : 0;
      const overflowSign = ratio < 0 ? -1 : 1;
      const dampedOverflow = (overflowSign * overflow) / 22;
      xDrag = Math.min(1, Math.max(0, ratio)) + dampedOverflow;
      springs.xRatio.setTarget(xDrag);
      start();
    }

    function onUp(ev) {
      if (!pointerDown) return;
      pointerDown = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const distance = Math.abs(ev.clientX - initialX);
      if (distance < 4) setChecked(!checked, true);
      else setChecked(xDrag > 0.5, true);
      start();
    }

    thumb.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      pointerDown = true;
      initialX = ev.clientX;
      xDrag = checked ? 1 : 0;
      thumb.focus({ preventScroll: true });
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      start();
    });

    track.addEventListener("click", (ev) => {
      if (ev.target === track) setChecked(!checked, true);
    });

    thumb.addEventListener("keydown", (ev) => {
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        setChecked(!checked, true);
      } else if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        setChecked(false, true);
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        setChecked(true, true);
      }
    });

    const api = {
      card,
      options: o,
      isChecked: () => checked,
      setChecked: (v, silent) => setChecked(!!v, !silent),
      setForceActive(flag) {
        forceActive = !!flag;
        start();
      },
    };

    valueEl.textContent = checked ? "ON" : "OFF";
    thumb.setAttribute("aria-checked", String(checked));
    start();
    registry.switches.push(api);
    return api;
  }

  /* ===================================================================
     5. PRESETS DE LA LENTILLE (boutons sur une seule ligne)
     =================================================================== */

  const PRESETS = [
    { name: "Défaut", w: 200, h: 140, r: 70, surface: "convex_squircle", bezel: 30, thickness: 150, refraction: 1.5, specular: 1, blur: 0.5 },
    { name: "Loupe", w: 180, h: 180, r: 90, surface: "convex_circle", bezel: 60, thickness: 180, refraction: 1.5, specular: 1, blur: 0 },
    { name: "Capsule", w: 320, h: 110, r: 55, surface: "convex_squircle", bezel: 26, thickness: 120, refraction: 1.2, specular: 0.8, blur: 0.3 },
    { name: "Goutte", w: 150, h: 210, r: 75, surface: "convex_circle", bezel: 50, thickness: 160, refraction: 1.4, specular: 1, blur: 0.4 },
    { name: "Cristal", w: 240, h: 150, r: 60, surface: "lip", bezel: 40, thickness: 140, refraction: 1.3, specular: 1, blur: 0.2 },
    { name: "Gel", w: 220, h: 140, r: 70, surface: "concave", bezel: 45, thickness: 110, refraction: 1.5, specular: 0.7, blur: 0.8 },
    { name: "Givré", w: 260, h: 140, r: 50, surface: "convex_squircle", bezel: 20, thickness: 90, refraction: 0.6, specular: 0.6, blur: 3.5 },
    { name: "Bulle", w: 130, h: 130, r: 65, surface: "convex_circle", bezel: 65, thickness: 200, refraction: 1.5, specular: 1, blur: 0 },
    { name: "Bandeau", w: 420, h: 80, r: 40, surface: "convex_squircle", bezel: 24, thickness: 100, refraction: 1.1, specular: 0.9, blur: 0.5 },
    { name: "Extrême", w: 200, h: 140, r: 70, surface: "convex_squircle", bezel: 70, thickness: 200, refraction: 1.5, specular: 1, blur: 0 },
  ];

  const LENS_CONTROLS = [
    { id: "bezelWidth", prop: "bezelWidth", label: "Bezel Width", min: 5, max: 70, step: 1, fmt: (v) => String(Math.round(v)) },
    { id: "glassThickness", prop: "glassThickness", label: "Glass Thickness", min: 10, max: 200, step: 1, fmt: (v) => String(Math.round(v)) },
    { id: "refractionScale", prop: "refractionScale", label: "Refraction Scale", min: 0, max: 1.5, step: 0.01, fmt: (v) => v.toFixed(2) },
    { id: "specularOpacity", prop: "specularOpacity", label: "Specular Opacity", min: 0, max: 1, step: 0.01, fmt: (v) => v.toFixed(2) },
    { id: "blur", prop: "blur", label: "Blur", min: 0, max: 10, step: 0.1, fmt: (v) => v.toFixed(1) },
  ];

  const lensSliders = {};

  function syncNative(control, value) {
    const input = document.getElementById(control.id);
    const label = document.getElementById(control.id + "Value");
    if (input) input.value = value;
    if (label) label.textContent = control.fmt(value);
  }

  function syncLinkedSliders() {
    LENS_CONTROLS.forEach((c) => {
      if (lensSliders[c.id]) lensSliders[c.id].setValue(state[c.prop], true);
    });
  }

  let presetButtons = [];

  function setActivePreset(name) {
    presetButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.preset === name));
  }

  function applyLens(p) {
    const area = document.getElementById("demoArea");
    const areaRect = area.getBoundingClientRect();

    state.objectWidth = p.w;
    state.objectHeight = p.h;
    state.radius = p.r;
    state.surfaceType = p.surface;
    state.bezelWidth = p.bezel;
    state.glassThickness = p.thickness;
    state.refractionScale = p.refraction;
    state.specularOpacity = p.specular;
    state.blur = p.blur;

    glassElement.style.width = p.w + "px";
    glassElement.style.height = p.h + "px";
    glassElement.style.borderRadius = p.r + "px";

    ["displacementImage", "specularImage"].forEach((imgId) => {
      const img = document.getElementById(imgId);
      img.setAttribute("width", p.w);
      img.setAttribute("height", p.h);
    });

    const clipRect = document.querySelector("#glassClip rect");
    if (clipRect) {
      clipRect.setAttribute("width", p.w);
      clipRect.setAttribute("height", p.h);
      clipRect.setAttribute("rx", p.r);
      clipRect.setAttribute("ry", p.r);
    }

    [displacementPreview, specularPreview].forEach((cv) => {
      cv.width = p.w;
      cv.height = p.h;
    });

    document.querySelectorAll(".surface-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.surface === p.surface);
    });

    LENS_CONTROLS.forEach((c) => syncNative(c, state[c.prop]));

    // Garde la lentille dans la zone
    const curX = parseFloat(glassElement.style.left) || 0;
    const curY = parseFloat(glassElement.style.top) || 0;
    glassElement.style.left = clamp(curX, 0, Math.max(0, areaRect.width - p.w)) + "px";
    glassElement.style.top = clamp(curY, 0, Math.max(0, areaRect.height - p.h)) + "px";

    updateFilter();
    updateContentClonePosition(true);
    startAnimationLoop();
    syncLinkedSliders();
  }

  function randomPreset() {
    const rnd = (a, b) => a + Math.random() * (b - a);
    const w = Math.round(rnd(110, 380));
    const hh = Math.round(rnd(80, 220));
    const r = Math.round(Math.min(w, hh) / 2 - rnd(0, Math.min(w, hh) / 4));
    const surfaces = Object.keys(SurfaceEquations);
    return {
      name: "Aléatoire",
      w,
      h: hh,
      r,
      surface: surfaces[Math.floor(Math.random() * surfaces.length)],
      bezel: Math.round(clamp(rnd(10, r), 5, 70)),
      thickness: Math.round(rnd(40, 200)),
      refraction: +rnd(0.4, 1.5).toFixed(2),
      specular: +rnd(0.3, 1).toFixed(2),
      blur: +rnd(0, 3).toFixed(1),
    };
  }

  function buildPresetRow() {
    const row = document.getElementById("presetRow");
    if (!row) return;

    PRESETS.forEach((p) => {
      const btn = h("button", "preset-btn", null, row);
      btn.type = "button";
      btn.textContent = p.name;
      btn.dataset.preset = p.name;
      if (p.name === "Défaut") btn.classList.add("is-active");
      btn.addEventListener("click", () => {
        applyLens(p);
        setActivePreset(p.name);
      });
      presetButtons.push(btn);
    });

    const rndBtn = h("button", "preset-btn is-action", null, row);
    rndBtn.type = "button";
    rndBtn.textContent = "🎲 Aléatoire";
    rndBtn.addEventListener("click", () => {
      applyLens(randomPreset());
      setActivePreset(null);
    });

    // Si l'utilisateur touche à un réglage, le preset n'est plus "actif"
    document.querySelectorAll(".surface-btn").forEach((b) =>
      b.addEventListener("click", () => setActivePreset(null)),
    );
    LENS_CONTROLS.forEach((c) => {
      const input = document.getElementById(c.id);
      if (input) input.addEventListener("input", () => setActivePreset(null));
    });
  }

  /* ===================================================================
     6. BANQUE DE CURSEURS
     =================================================================== */

  function buildLensGroup() {
    const grid = document.getElementById("bankLens");
    if (!grid) return;

    LENS_CONTROLS.forEach((c) => {
      const inst = createGlassSlider(grid, {
        label: c.label,
        note: "Lié à la lentille interactive : bouge ce curseur, la loupe réagit.",
        min: c.min,
        max: c.max,
        step: c.step,
        value: state[c.prop],
        format: c.fmt,
        fillColor: "#667eea",
        onChange: (v) => {
          state[c.prop] = v;
          syncNative(c, v);
          setActivePreset(null);
          updateFilter();
        },
      });
      lensSliders[c.id] = inst;

      const input = document.getElementById(c.id);
      if (input) {
        input.addEventListener("input", () => inst.setValue(parseFloat(input.value), true));
      }
    });
  }

  function buildColorGroup() {
    const grid = document.getElementById("bankColors");
    if (!grid) return;

    const colors = [
      { label: "Bleu", color: "#0377f7", value: 62 },
      { label: "Vert", color: "#34c759", value: 35 },
      { label: "Orange", color: "#ff9f0a", value: 80 },
      { label: "Rouge", color: "#ff3b30", value: 18 },
      { label: "Violet", color: "#af52de", value: 54 },
      { label: "Rose", color: "#ff2d92", value: 72 },
      { label: "Turquoise", color: "#30b0c7", value: 46 },
      { label: "Graphite", color: "#636366", value: 90 },
    ];

    colors.forEach((c, i) => {
      createGlassSlider(grid, {
        label: c.label,
        min: 0,
        max: 100,
        step: 1,
        value: c.value,
        unit: "%",
        fillColor: c.color,
        specular: 0.3 + (i % 4) * 0.12,
        refraction: 0.8 + (i % 3) * 0.2,
      });
    });
  }

  function buildGradientGroup() {
    const grid = document.getElementById("bankGradients");
    if (!grid) return;

    const hueStops = [];
    for (let i = 0; i <= 12; i++) hueStops.push(`hsl(${i * 30}, 90%, 55%)`);

    const defs = [
      {
        label: "Teinte",
        min: 0,
        max: 360,
        step: 1,
        value: 210,
        unit: "°",
        track: `linear-gradient(90deg, ${hueStops.join(", ")})`,
        note: "Piste arc-en-ciel : le verre déforme les couleurs sous le curseur.",
      },
      {
        label: "Température",
        min: 2000,
        max: 10000,
        step: 100,
        value: 6500,
        unit: " K",
        track: "linear-gradient(90deg, #ff8a2b, #ffd9a8, #ffffff, #bcd8ff, #6fa8ff)",
      },
      {
        label: "Luminosité",
        min: 0,
        max: 100,
        step: 1,
        value: 70,
        unit: "%",
        track: "linear-gradient(90deg, #0b0b10, #8a8a95, #ffffff)",
      },
      {
        label: "Saturation",
        min: 0,
        max: 100,
        step: 1,
        value: 55,
        unit: "%",
        track: "linear-gradient(90deg, #9a9a9a, #ff3b30)",
      },
    ];

    defs.forEach((d) => {
      createGlassSlider(grid, {
        label: d.label,
        note: d.note || "",
        min: d.min,
        max: d.max,
        step: d.step,
        value: d.value,
        unit: d.unit,
        fillColor: null,
        trackBackground: d.track,
        trackW: 320,
        trackH: 18,
        thumbW: 96,
        thumbH: 62,
        thumbR: 31,
        bezel: 18,
        thickness: 90,
        specular: 0.5,
        saturation: 3,
        areaH: 120,
      });
    });
  }

  function buildShapeGroup() {
    const grid = document.getElementById("bankShapes");
    if (!grid) return;

    const shapes = [
      { label: "Pilule XL", thumbW: 120, thumbH: 70, thumbR: 35, trackW: 320, trackH: 18, bezel: 20, thickness: 90, color: "#0377f7" },
      { label: "Mini", thumbW: 60, thumbH: 40, thumbR: 20, trackW: 260, trackH: 8, bezel: 10, thickness: 50, color: "#34c759", areaH: 90 },
      { label: "Carré arrondi", thumbW: 70, thumbH: 70, thumbR: 22, trackW: 300, trackH: 14, bezel: 18, thickness: 80, color: "#ff9f0a" },
      { label: "Rond parfait", thumbW: 64, thumbH: 64, thumbR: 32, trackW: 300, trackH: 12, bezel: 22, thickness: 90, color: "#af52de" },
      { label: "Piste épaisse", thumbW: 100, thumbH: 56, thumbR: 28, trackW: 320, trackH: 30, bezel: 16, thickness: 80, color: "#ff2d92" },
      { label: "Piste fine", thumbW: 80, thumbH: 56, thumbR: 28, trackW: 320, trackH: 4, bezel: 16, thickness: 80, color: "#30b0c7", areaH: 100 },
      { label: "Loupe forte", thumbW: 110, thumbH: 80, thumbR: 40, trackW: 320, trackH: 14, bezel: 30, thickness: 140, n: 1.9, refraction: 1.4, color: "#ff3b30", areaH: 130 },
      { label: "Verre dépoli", thumbW: 100, thumbH: 60, thumbR: 30, trackW: 320, trackH: 14, bezel: 16, thickness: 60, blur: 4, refraction: 0.5, color: "#636366" },
    ];

    shapes.forEach((s, i) => {
      createGlassSlider(grid, {
        label: s.label,
        min: 0,
        max: 100,
        step: 1,
        value: 25 + ((i * 17) % 60),
        unit: "%",
        fillColor: s.color,
        thumbW: s.thumbW,
        thumbH: s.thumbH,
        thumbR: s.thumbR,
        trackW: s.trackW,
        trackH: s.trackH,
        bezel: s.bezel,
        thickness: s.thickness,
        n: s.n || 1.45,
        blur: s.blur || 0,
        refraction: s.refraction || 1,
        areaH: s.areaH || 110,
      });
    });
  }

  function buildSurfaceGroup() {
    const grid = document.getElementById("bankSurfaces");
    if (!grid) return;

    const defs = [
      { label: "Convex Squircle", surface: "convex_squircle", n: 1.45, color: "#0377f7" },
      { label: "Convex Circle", surface: "convex_circle", n: 1.45, color: "#34c759" },
      { label: "Concave", surface: "concave", n: 1.45, color: "#ff9f0a" },
      { label: "Lip", surface: "lip", n: 1.45, color: "#af52de" },
      { label: "Indice 1.1 (faible)", surface: "convex_squircle", n: 1.1, color: "#30b0c7" },
      { label: "Indice 1.9 (fort)", surface: "convex_squircle", n: 1.9, color: "#ff3b30" },
    ];

    defs.forEach((d, i) => {
      createGlassSlider(grid, {
        label: d.label,
        note: `surface = ${d.surface} · n = ${d.n}`,
        min: 0,
        max: 100,
        step: 1,
        value: 30 + i * 9,
        unit: "%",
        fillColor: d.color,
        surface: d.surface,
        n: d.n,
        bezel: 20,
        thickness: 100,
        thumbW: 100,
        thumbH: 64,
        thumbR: 32,
        areaH: 120,
      });
    });
  }

  /* ===================================================================
     7. BANQUE D'INTERRUPTEURS
     =================================================================== */

  function buildSwitchBank() {
    const grid = document.getElementById("bankSwitches");
    if (!grid) return;

    const defs = [
      { label: "Vert (iOS)", on: [59, 191, 78, 0.93], checked: true },
      { label: "Bleu", on: [10, 132, 255, 0.93], checked: true },
      { label: "Orange", on: [255, 159, 10, 0.93], checked: false },
      { label: "Rouge", on: [255, 69, 58, 0.93], checked: true },
      { label: "Violet", on: [175, 82, 222, 0.93], checked: false },
      { label: "Turquoise", on: [48, 176, 199, 0.93], checked: true },
      { label: "Graphite", on: [99, 99, 102, 0.93], checked: false },
      { label: "Or", on: [255, 204, 0, 0.93], checked: true },
    ];

    defs.forEach((d, i) => {
      createGlassSwitch(grid, {
        label: d.label,
        checked: d.checked,
        onColor: d.on,
        specular: 0.35 + (i % 4) * 0.12,
        saturation: 4 + (i % 3) * 2,
        refraction: 0.8 + (i % 3) * 0.2,
        onChange: (v) => toast(`${d.label} → ${v ? "ON" : "OFF"}`),
      });
    });
  }

  /* ===================================================================
     8. BANQUE DE CURSEURS SOURIS
     =================================================================== */

  const CSS_CURSORS = [
    ["auto", "⌖"], ["default", "➤"], ["none", "∅"], ["context-menu", "☰"],
    ["help", "?"], ["pointer", "☝"], ["progress", "◔"], ["wait", "⏳"],
    ["cell", "✚"], ["crosshair", "+"], ["text", "I"], ["vertical-text", "⌶"],
    ["alias", "↪"], ["copy", "⧉"], ["move", "✥"], ["no-drop", "⊘"],
    ["not-allowed", "🚫"], ["grab", "✋"], ["grabbing", "✊"], ["all-scroll", "⇕"],
    ["col-resize", "⇔"], ["row-resize", "⇕"], ["n-resize", "↑"], ["e-resize", "→"],
    ["s-resize", "↓"], ["w-resize", "←"], ["ne-resize", "↗"], ["nw-resize", "↖"],
    ["se-resize", "↘"], ["sw-resize", "↙"], ["ew-resize", "↔"], ["ns-resize", "↕"],
    ["nesw-resize", "⤢"], ["nwse-resize", "⤡"], ["zoom-in", "🔍"], ["zoom-out", "🔎"],
  ];

  function svgCursor(svgMarkup, hx, hy, fallback) {
    const encoded = encodeURIComponent(svgMarkup)
      .replace(/'/g, "%27")
      .replace(/"/g, "%22");
    return `url("data:image/svg+xml;utf8,${encoded}") ${hx} ${hy}, ${fallback}`;
  }

  const CUSTOM_CURSORS = [
    {
      name: "anneau",
      glyph: "◯",
      css: svgCursor(
        "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><circle cx='16' cy='16' r='11' fill='none' stroke='white' stroke-width='4'/><circle cx='16' cy='16' r='11' fill='none' stroke='black' stroke-width='1.5'/></svg>",
        16, 16, "auto",
      ),
    },
    {
      name: "point",
      glyph: "●",
      css: svgCursor(
        "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><circle cx='12' cy='12' r='6' fill='black' stroke='white' stroke-width='2.5'/></svg>",
        12, 12, "auto",
      ),
    },
    {
      name: "flèche",
      glyph: "➤",
      css: svgCursor(
        "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><path d='M4 3 L4 22 L9 17.5 L12.5 25 L16 23.5 L12.5 16.5 L19.5 16.5 Z' fill='black' stroke='white' stroke-width='1.8' stroke-linejoin='round'/></svg>",
        4, 3, "default",
      ),
    },
    {
      name: "viseur",
      glyph: "⌖",
      css: svgCursor(
        "<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36'><g stroke='white' stroke-width='4' stroke-linecap='round'><path d='M18 3v9M18 24v9M3 18h9M24 18h9'/></g><g stroke='black' stroke-width='1.6' stroke-linecap='round'><path d='M18 3v9M18 24v9M3 18h9M24 18h9'/></g><circle cx='18' cy='18' r='2' fill='black'/></svg>",
        18, 18, "crosshair",
      ),
    },
    {
      name: "lentille",
      glyph: "◉",
      css: svgCursor(
        "<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44'><defs><radialGradient id='g' cx='35%' cy='30%' r='75%'><stop offset='0' stop-color='white' stop-opacity='.95'/><stop offset='.45' stop-color='#9fb4ff' stop-opacity='.35'/><stop offset='1' stop-color='#667eea' stop-opacity='.55'/></radialGradient></defs><circle cx='22' cy='22' r='18' fill='url(#g)' stroke='white' stroke-width='2'/><circle cx='22' cy='22' r='18.8' fill='none' stroke='rgba(0,0,0,.35)' stroke-width='1'/></svg>",
        22, 22, "auto",
      ),
    },
    {
      name: "main",
      glyph: "☝",
      css: svgCursor(
        "<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 30 30'><path d='M11 3a2 2 0 0 1 4 0v9l2-.6a2 2 0 0 1 2.4 1.4l.3.1a2 2 0 0 1 2.7 1.4l.4.1a2 2 0 0 1 2.2 2.3L23.8 24a4 4 0 0 1-4 3.4h-5a4 4 0 0 1-3.3-1.8L7 20.2a2 2 0 0 1 3-2.5l1 .9z' fill='white' stroke='black' stroke-width='1.6' stroke-linejoin='round'/></svg>",
        13, 3, "pointer",
      ),
    },
  ];

  function makeCursorTile(grid, name, glyph, cssValue) {
    const tile = h("button", "cursor-tile", { cursor: cssValue }, grid);
    tile.type = "button";
    tile.dataset.name = name;

    const g = h("div", "cursor-tile-glyph", null, tile);
    g.textContent = glyph;
    const n = h("div", "cursor-tile-name", null, tile);
    n.textContent = name;
    const hint = h("div", "cursor-tile-hint", null, tile);
    hint.textContent = "clic = copier";

    tile.addEventListener("click", () => {
      const isCustom = cssValue.startsWith("url(");
      const css = isCustom ? `cursor: ${cssValue};` : `cursor: ${name};`;
      copyText(css, `Copié : ${isCustom ? "cursor: url(…)" : css}`);
    });
    return tile;
  }

  function buildCursorBank() {
    const grid = document.getElementById("bankCursors");
    const customGrid = document.getElementById("bankCustomCursors");
    const search = document.getElementById("cursorSearch");
    const count = document.getElementById("cursorCount");
    if (!grid) return;

    const tiles = CSS_CURSORS.map(([name, glyph]) => makeCursorTile(grid, name, glyph, name));

    const empty = h("div", "cursor-empty", { display: "none" }, grid);
    empty.textContent = "Aucun curseur ne correspond à la recherche.";

    function updateCount(visible) {
      if (count) count.textContent = `${visible} / ${CSS_CURSORS.length}`;
    }
    updateCount(CSS_CURSORS.length);

    if (search) {
      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        let visible = 0;
        tiles.forEach((t) => {
          const match = !q || t.dataset.name.includes(q);
          t.style.display = match ? "" : "none";
          if (match) visible++;
        });
        empty.style.display = visible ? "none" : "block";
        updateCount(visible);
      });
    }

    if (customGrid) {
      CUSTOM_CURSORS.forEach((c) => makeCursorTile(customGrid, c.name, c.glyph, c.css));
    }
  }

  /* ===================================================================
     9. TÉLÉMÉTRIE + EXPORT
     =================================================================== */

  let fps = 0;
  function startFpsCounter() {
    let frames = 0;
    let last = performance.now();
    function tick(now) {
      frames++;
      if (now - last >= 500) {
        fps = Math.round((frames * 1000) / (now - last));
        frames = 0;
        last = now;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function setStat(key, html) {
    const node = document.querySelector(`[data-stat="${key}"]`);
    if (node) node.innerHTML = html;
  }

  function refreshStats() {
    setStat("fps", `${fps} <small>fps</small>`);
    setStat("mode", useBackdropFilter ? "backdrop-filter" : "clone");
    setStat("surface", state.surfaceType.replace("_", " "));
    setStat("displacement", `${state.maximumDisplacement.toFixed(1)} <small>px</small>`);
    setStat("size", `${state.objectWidth}×${state.objectHeight} <small>r${state.radius}</small>`);
    setStat("bezel", `${Math.round(state.bezelWidth)} <small>/</small> ${Math.round(state.glassThickness)}`);
    setStat("refraction", state.refractionScale.toFixed(2));
    setStat("position", `${Math.round(parseFloat(glassElement.style.left) || 0)}, ${Math.round(parseFloat(glassElement.style.top) || 0)}`);
    setStat("sliders", String(registry.sliders.length));
    setStat("switches", String(registry.switches.length));
    setStat("filters", String(document.querySelectorAll("svg filter").length));
    setStat("cache", String(mapCache.size));
  }

  function currentConfig() {
    return {
      surfaceType: state.surfaceType,
      objectWidth: state.objectWidth,
      objectHeight: state.objectHeight,
      radius: state.radius,
      bezelWidth: state.bezelWidth,
      glassThickness: state.glassThickness,
      refractiveIndex: state.refractiveIndex,
      refractionScale: state.refractionScale,
      specularOpacity: state.specularOpacity,
      blur: state.blur,
    };
  }

  function buildToolRow() {
    const row = document.getElementById("toolRow");
    if (!row) return;

    const actions = [
      {
        label: "Copier la config (JSON)",
        run: () => copyText(JSON.stringify(currentConfig(), null, 2), "Config copiée (JSON)"),
      },
      {
        label: "Copier en CSS custom properties",
        run: () => {
          const c = currentConfig();
          const css = [
            ":root {",
            `  --glass-surface: ${c.surfaceType};`,
            `  --glass-width: ${c.objectWidth}px;`,
            `  --glass-height: ${c.objectHeight}px;`,
            `  --glass-radius: ${c.radius}px;`,
            `  --glass-bezel: ${c.bezelWidth};`,
            `  --glass-thickness: ${c.glassThickness};`,
            `  --glass-refractive-index: ${c.refractiveIndex};`,
            `  --glass-refraction: ${c.refractionScale};`,
            `  --glass-specular: ${c.specularOpacity};`,
            `  --glass-blur: ${c.blur};`,
            "}",
          ].join("\n");
          copyText(css, "Config copiée (CSS)");
        },
      },
      {
        label: "Forcer l'état actif (tous les curseurs)",
        run: () => {
          const next = !registry._forced;
          registry._forced = next;
          registry.sliders.forEach((s) => s.setForceActive(next));
          registry.switches.forEach((s) => s.setForceActive(next));
          toast(next ? "Tous les verres sont actifs" : "État actif relâché");
        },
      },
      {
        label: "Réinitialiser la lentille",
        run: () => {
          applyLens(PRESETS[0]);
          setActivePreset("Défaut");
          toast("Lentille réinitialisée");
        },
      },
    ];

    actions.forEach((a) => {
      const btn = h("button", "preset-btn", null, row);
      btn.type = "button";
      btn.textContent = a.label;
      btn.addEventListener("click", a.run);
    });
  }

  /* ===================================================================
     10. NAVIGATION + DÉMARRAGE
     =================================================================== */

  function buildNav() {
    const container = document.querySelector(".container");
    const subtitle = document.querySelector(".subtitle");
    if (!container || !subtitle) return;

    const sections = document.querySelectorAll(".demo-section");
    const knownIds = ["lentille", "demo-curseur", "demo-interrupteur"];
    sections.forEach((sec, idx) => {
      if (!sec.id && knownIds[idx]) sec.id = knownIds[idx];
    });
    const mapsSection = Array.from(sections).find((s) =>
      s.querySelector("#displacementPreview"),
    );
    if (mapsSection && !mapsSection.id) mapsSection.id = "cartes";

    const items = [
      ["lentille", "Lentille"],
      ["demo-curseur", "Slider"],
      ["demo-interrupteur", "Switch"],
      ["banque-curseurs", "Banque de curseurs"],
      ["banque-interrupteurs", "Interrupteurs"],
      ["banque-souris", "Curseurs souris"],
      ["telemetrie", "Télémétrie"],
      ["cartes", "Cartes générées"],
    ];

    const nav = h("nav", "top-nav", null, null);
    nav.setAttribute("aria-label", "Sections");
    const links = [];
    items.forEach(([target, text]) => {
      if (!document.getElementById(target)) return;
      const a = h("a", null, null, nav);
      a.href = "#" + target;
      a.textContent = text;
      links.push(a);
    });
    subtitle.insertAdjacentElement("afterend", nav);

    // Lien actif selon la section visible
    if ("IntersectionObserver" in window) {
      const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              links.forEach((l) => l.classList.remove("is-active"));
              const link = byId.get(entry.target.id);
              if (link) {
                link.classList.add("is-active");
                link.scrollIntoView({ block: "nearest", inline: "center" });
              }
            }
          });
        },
        { rootMargin: "-30% 0px -60% 0px" },
      );
      byId.forEach((_, id) => observer.observe(document.getElementById(id)));
    }
  }

  function initBank() {
    buildPresetRow();
    buildLensGroup();
    buildColorGroup();
    buildGradientGroup();
    buildShapeGroup();
    buildSurfaceGroup();
    buildSwitchBank();
    buildCursorBank();
    buildToolRow();
    buildNav();
    startFpsCounter();
    refreshStats();
    setInterval(refreshStats, 300);

    // Les positions des clones dépendent de la mise en page finale
    window.addEventListener("load", () => registry.sliders.forEach((s) => s.refresh()));
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => registry.sliders.forEach((s) => s.refresh()));
    }

    console.log(
      `Banque initialisée : ${registry.sliders.length} curseurs, ${registry.switches.length} interrupteurs, ${CSS_CURSORS.length + CUSTOM_CURSORS.length} curseurs souris`,
    );
  }

  // API publique (utile pour réutiliser les fabriques ailleurs)
  window.LiquidGlassBank = {
    createGlassSlider,
    createGlassSwitch,
    applyLens,
    PRESETS,
    registry,
    toast,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBank);
  } else {
    initBank();
  }
})();
