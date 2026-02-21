/*jslint browser: true*/
/*global Tangram, L, dat, saveAs */

map = (function () {
  'use strict';
  
  var map_start_location = [0, 0, 2];
  var uminValue, umaxValue; 
  var scene_loaded = false;
  var analysing = false;
  var done = false;
  var tempCanvas;
  var spread = 1;
  var lastumax = null;
  var diff = null;
  var stopped = false; 
  var moving = false; 
  var widening = false;
  var tempFactor = 8; 
  
  const mb_factor = 1.0 / (1024 * 1024);
  const min_zoomRender = 1;
  const max_zoomRender = 8; 
  
  var url_hash = window.location.hash.slice(1, window.location.hash.length).split('/');
  if (url_hash.length == 3) {
    map_start_location = [url_hash[1],url_hash[2], url_hash[0]];
    map_start_location = map_start_location.map(Number);
  }
  
  var map = L.map('map', {
    "keyboardZoomOffset" : .05,
    "inertiaDeceleration" : 10000,
    "zoomSnap" : .001
  });
  
  // ENGINE 1: TERRAIN ONLY
  var terrainLayer = Tangram.leafletLayer({
    scene: 'scene-terrain.yaml',
    attribution: 'Stadia Maps | Tangram',
    postUpdate: function() {
      if (gui && gui.autoexpose && !stopped && !moving) {
        if (!analysing && !done) expose();
        else if (analysing && !done) start_analysis();
        else if (done) done = false;
      }
    }
  });

  // ENGINE 2: WATER ONLY
  var waterLayer = Tangram.leafletLayer({
    scene: 'scene-water.yaml'
  });
  
  function debounce(func, wait, immediate) {
    var timeout;
    return function() {
      var context = this, args = arguments;
      var later = function() {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };
      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(context, args);
    };
  };
  
  function expose() {
    analysing = true;
    if (typeof gui != 'undefined' && gui.autoexpose == false) return false;
    if (scene_loaded) start_analysis();
    else terrainLayer.scene.initializing.then(start_analysis);
  }
  
  function updateGUI() {
    for (var i in gui.__controllers) gui.__controllers[i].updateDisplay();
    for (var folder in gui.__folders) {
      for (var i in gui.__folders[folder].__controllers) {
        gui.__folders[folder].__controllers[i].updateDisplay();
      }
    }
  }
  
  function start_analysis() {
    var levels = analyse();
    diff = levels.max - lastumax;
    if (typeof levels.max !== 'undefined') lastumax = levels.max;
    else diff = 1;
    widening = diff < 0 ? false : true;
    if (levels) {
      terrainLayer.scene.styles.hillshade.shaders.uniforms.u_min = levels.min;
      terrainLayer.scene.styles.hillshade.shaders.uniforms.u_max = levels.max;
    }
    terrainLayer.scene.requestRedraw();
  }
  
  function analyse() {
    if (!tempCanvas || !terrainLayer.scene || !terrainLayer.scene.canvas) return false;
    
    let expectedW = Math.floor(terrainLayer.scene.canvas.width/tempFactor);
    let expectedH = Math.floor(terrainLayer.scene.canvas.height/tempFactor);
    if (tempCanvas.width !== expectedW) {
        tempCanvas.width = expectedW;
        tempCanvas.height = expectedH;
    }

    var ctx = tempCanvas.getContext("2d", { willReadFrequently: true }); 
    ctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    ctx.drawImage(terrainLayer.scene.canvas, 0, 0, tempCanvas.width, tempCanvas.height);
    var pixels = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    
    var val, empty = true, max = 0, min = 255;
    for (var i = 0; i < tempCanvas.height * tempCanvas.width * 4; i += 4) {
      if (pixels.data[i+3] === 0) continue;
      val = pixels.data[i]; 
      empty = false;
      min = Math.min(min, val);
      max = Math.max(max, val);
    }
    
    if (empty) return false;
    
    if (max > 253 && min < 4 && !widening ) {
      analysing = false;
      done = true;
      spread = 2;
      return false;
    }
    if (max > 252 && min < 4 && widening) {
      spread = Math.min(spread * 2, 512);
      max += spread;
      min -= spread;
    }
    
    var range = (gui.u_max - gui.u_min);
    var minadj = Math.max((min / 255) * range + gui.u_min, 0); 
    var maxadj = Math.min((max / 255) * range + gui.u_min, 8900);
    if (minadj === maxadj) maxadj += 10;
    
    var xscale = (gui.u_max - gui.u_min) / terrainLayer.scene.view.size.meters.x;
    gui.scaleFactor = xscale +''; 
    
    terrainLayer.scene.styles.hillshade.shaders.uniforms.u_min = minadj;
    terrainLayer.scene.styles.hillshade.shaders.uniforms.u_max = maxadj;
    
    gui.u_min = minadj;
    gui.u_max = maxadj;
    updateGUI();
    return {max: maxadj, min: minadj}
  }
  
  window.terrainLayer = terrainLayer;
  window.waterLayer = waterLayer;
  
  map.setView(map_start_location.slice(0, 3), map_start_location[2]);
  let hash = new L.Hash(map);

  var gui;
  function addGUI () {
    gui.domElement.parentNode.style.zIndex = 5; 
    window.gui = gui;

    // --- API KEY CONFIGURATION ---
    let keyFolder = gui.addFolder('API Key Configuration');
    gui.api_key = localStorage.getItem('stadia_api_key') || '';
    
    keyFolder.add(gui, 'api_key').name("Stadia Key").onChange(function(value) {
        let val = value.trim();
        localStorage.setItem('stadia_api_key', val);
        
        if (terrainLayer.scene && terrainLayer.scene.config.sources.elevation) {
            terrainLayer.scene.config.sources.elevation.url_params = terrainLayer.scene.config.sources.elevation.url_params || {};
            terrainLayer.scene.config.sources.elevation.url_params.api_key = val;
            terrainLayer.scene.updateConfig();
        }
        if (waterLayer.scene && waterLayer.scene.config.sources.nhd_data) {
            waterLayer.scene.config.sources.nhd_data.url_params = waterLayer.scene.config.sources.nhd_data.url_params || {};
            waterLayer.scene.config.sources.nhd_data.url_params.api_key = val;
            waterLayer.scene.updateConfig();
        }
    });
    keyFolder.open();
    // -----------------------------
    
    gui.u_max = 8848.;
    gui.add(gui, 'u_max', -10916., 8848).name("max elevation").onChange(function(value) {
      terrainLayer.scene.styles.hillshade.shaders.uniforms.u_max = value;
      terrainLayer.scene.requestRedraw();
    });
    
    gui.u_min = 0.;
    gui.add(gui, 'u_min', -10916., 8848).name("min elevation").onChange(function(value) {
      terrainLayer.scene.styles.hillshade.shaders.uniforms.u_min = value;
      terrainLayer.scene.requestRedraw();
    });
    
    gui.scaleFactor = 1 +'';
    gui.add(gui, 'scaleFactor').name("z:x scale factor");
    
    gui.autoexpose = true;
    gui.add(gui, 'autoexpose').name("auto-exposure").onChange(function(value) {
      sliderState(!value);
      if (value) {
        uminValue = gui.u_min;
        umaxValue = gui.u_max;
        lastumax = 0;
        expose();
      } else if (typeof uminValue != 'undefined') {
        terrainLayer.scene.styles.hillshade.shaders.uniforms.u_min = uminValue;
        terrainLayer.scene.styles.hillshade.shaders.uniforms.u_max = umaxValue;
        terrainLayer.scene.requestRedraw();
        gui.u_min = uminValue;
        gui.u_max = umaxValue;
        updateGUI();
      }
    });

    let waterFolder = gui.addFolder('Water Mask Settings');
    gui.show_water = true;
    waterFolder.add(gui, 'show_water').name("Show Water").onChange(function(value) {
        if (waterLayer.scene && waterLayer.scene.canvas) {
            waterLayer.scene.canvas.style.display = value ? 'block' : 'none';
        }
    });
    
    gui.water_thickness = 2;
    waterFolder.add(gui, 'water_thickness', 0.5, 15, 0.5).name("River Width (px)").onChange(function(value) {
        if (waterLayer.scene && waterLayer.scene.config.layers.nhd_lines) {
            waterLayer.scene.config.layers.nhd_lines.draw.lines.width = value + 'px';
            waterLayer.scene.updateConfig();
        }
    });
    waterFolder.open();

    let boxFolder = gui.addFolder('Export Resolution');
    gui.mapWidth = 800;
    gui.mapHeight = 800;
    gui.zoomRender = 1;
    gui.mapRotation = 0;
    gui.finalRes = "800 x 800 px";

    function updateBox() {
        let wrapper = document.getElementById('map-wrapper');
        let mapEl = document.getElementById('map');
        if (wrapper && mapEl) {
            wrapper.style.width = gui.mapWidth + 'px';
            wrapper.style.height = gui.mapHeight + 'px';

            let D = Math.ceil(Math.sqrt(gui.mapWidth*gui.mapWidth + gui.mapHeight*gui.mapHeight));
            mapEl.style.width = D + 'px';
            mapEl.style.height = D + 'px';
            mapEl.style.left = -(D - gui.mapWidth)/2 + 'px';
            mapEl.style.top = -(D - gui.mapHeight)/2 + 'px';

            let finalW = gui.mapWidth * gui.zoomRender;
            let finalH = gui.mapHeight * gui.zoomRender;
            gui.finalRes = finalW + " x " + finalH + " px";

            map.invalidateSize();
            updateGUI();
        }
    }

    boxFolder.add(gui, 'mapWidth', 256, 4096, 1).name('Base Width').onChange(updateBox);
    boxFolder.add(gui, 'mapHeight', 256, 4096, 1).name('Base Height').onChange(updateBox);
    boxFolder.add(gui, 'zoomRender', min_zoomRender, max_zoomRender, 1).name("Render Multiplier").onChange(function() {
        let finalW = gui.mapWidth * gui.zoomRender;
        let finalH = gui.mapHeight * gui.zoomRender;
        gui.finalRes = finalW + " x " + finalH + " px";
        updateGUI();
    });
    
    boxFolder.add(gui, 'mapRotation', 0, 360, 1).name("Compass Rotation").onChange(function(value) {
        document.getElementById('map').style.transform = `rotate(${value}deg)`;
    });

    boxFolder.add(gui, 'finalRes').name("FINAL OUTPUT");
    
    gui.resetBox = function() {
        gui.mapWidth = 800;
        gui.mapHeight = 800;
        gui.mapRotation = 0;
        document.getElementById('map').style.transform = `rotate(0deg)`;
        updateBox();
    };
    boxFolder.add(gui, 'resetBox').name("Reset View");
    boxFolder.open();
    
    gui.export_maps = function () { exportDualMaps(); }
    gui.add(gui, 'export_maps').name("EXPORT MAPS");

    gui.__controllers[2].domElement.firstChild.setAttribute("readonly", true);
    let finalResController = boxFolder.__controllers.find(c => c.property === 'finalRes');
    if (finalResController) finalResController.domElement.firstChild.setAttribute("readonly", true);

    updateBox();
  }

  function sliderState(active) {
    var pointerEvents = active ? "auto" : "none";
    var opacity = active ? 1. : .5;
    gui.__controllers[0].domElement.parentElement.style.pointerEvents = pointerEvents;
    gui.__controllers[0].domElement.parentElement.style.opacity = opacity;
    gui.__controllers[1].domElement.parentElement.style.pointerEvents = pointerEvents;
    gui.__controllers[1].domElement.parentElement.style.opacity = opacity;
  }
  
  window.addEventListener('load', function () {
    terrainLayer.on('init', function() {
      gui = new dat.GUI({ autoPlace: true, hideable: true, width: 320 });
      addGUI();
      
      // Auto-load saved key into terrain
      let savedKey = localStorage.getItem('stadia_api_key');
      if (savedKey && terrainLayer.scene.config.sources.elevation) {
          terrainLayer.scene.config.sources.elevation.url_params = terrainLayer.scene.config.sources.elevation.url_params || {};
          terrainLayer.scene.config.sources.elevation.url_params.api_key = savedKey;
          terrainLayer.scene.updateConfig();
      }

      terrainLayer.scene.subscribe({ view_complete: function() {} });
      scene_loaded = true;
      sliderState(false);
      tempCanvas = document.createElement("canvas");
      
      waterLayer.addTo(map); 
    });

    waterLayer.on('init', function() {
      // Auto-load saved key into water
      let savedKey = localStorage.getItem('stadia_api_key');
      if (savedKey && waterLayer.scene.config.sources.nhd_data) {
          waterLayer.scene.config.sources.nhd_data.url_params = waterLayer.scene.config.sources.nhd_data.url_params || {};
          waterLayer.scene.config.sources.nhd_data.url_params.api_key = savedKey;
          waterLayer.scene.updateConfig();
      }
    });
    
    terrainLayer.addTo(map);
    
    var moveend = debounce(function(e) {
      moving = false; 
      done = false;   
      terrainLayer.scene.resetViewComplete();
      terrainLayer.scene.requestRedraw();
      waterLayer.scene.requestRedraw();
    }, 250);
    
    map.on("movestart", function (e) { moving = true; });
    map.on("moveend", function (e) { moveend(e) });
  });

  // --- RENDERING PIPELINE ---
  
  function awaitBothViews() {
    let tWait = new Promise((resolve) => {
      let r = false;
      const h = () => { if (!r) { r = true; terrainLayer.scene.unsubscribe({ view_complete: h }); resolve(); } };
      terrainLayer.scene.subscribe({ view_complete: h });
      terrainLayer.scene.requestRedraw();
      setTimeout(h, 4000); 
    });  
    let wWait = new Promise((resolve) => {
      let r = false;
      const h = () => { if (!r) { r = true; waterLayer.scene.unsubscribe({ view_complete: h }); resolve(); } };
      waterLayer.scene.subscribe({ view_complete: h });
      waterLayer.scene.requestRedraw();
      setTimeout(h, 4000); 
    });
    return Promise.all([tWait, wWait]);
  }

  async function exportDualMaps() {
      const finalW = gui.mapWidth * gui.zoomRender;
      const finalH = gui.mapHeight * gui.zoomRender;
      const size_mb = Math.ceil(finalW * finalH * mb_factor);
      
      const status = confirm(`Final Resolution: ${finalW} x ${finalH} px\nEstimated memory per image: ~${size_mb} MB\n\nContinuing will export perfectly synced Height and Water maps. Continue?`);
      if(!status) return;

      const preRenderAutoExposureState = gui.autoexpose;
      gui.autoexpose = false; 

      try {
          console.log("Generating renders...");

          waterLayer.scene.config.scene.background.color = [0.0, 0.0, 0.0, 1.0];
          await waterLayer.scene.updateConfig();
          waterLayer.scene.canvas.style.display = 'block'; 

          let stitchedTerrain = document.createElement('canvas');
          let stitchedWater = document.createElement('canvas');

          if (gui.zoomRender === 1) {
              const tShot = await terrainLayer.scene.screenshot();
              const wShot = await waterLayer.scene.screenshot();
              
              await new Promise(r => { let img = new Image(); img.src = URL.createObjectURL(tShot.blob); img.onload = () => { stitchedTerrain.width = img.width; stitchedTerrain.height = img.height; stitchedTerrain.getContext('2d').drawImage(img, 0, 0); r(); } });
              await new Promise(r => { let img = new Image(); img.src = URL.createObjectURL(wShot.blob); img.onload = () => { stitchedWater.width = img.width; stitchedWater.height = img.height; stitchedWater.getContext('2d').drawImage(img, 0, 0); r(); } });
          } else {
              let zoomFactor = gui.zoomRender * window.devicePixelRatio;
              const outputX = terrainLayer.scene.canvas.width * gui.zoomRender;
              const outputY = terrainLayer.scene.canvas.height * gui.zoomRender;
              
              map.invalidateSize(true);
              const originalBounds = map.getBounds();
              
              const widthPerCell = terrainLayer.scene.canvas.width / zoomFactor;
              const heightPerCell = terrainLayer.scene.canvas.height / zoomFactor;
              const tCaptures = [], wCaptures = [], captureOrigins = [], cells = [];
              
              for(let i = 0; i < gui.zoomRender; i++) {
                for(let j = 0; j < gui.zoomRender; j++) {
                  const nwPoint = L.point(i * widthPerCell, j * heightPerCell, false);
                  const sePoint = L.point(nwPoint.x + widthPerCell, nwPoint.y + heightPerCell, false);
                  const bounds = L.latLngBounds(map.containerPointToLatLng(nwPoint), map.containerPointToLatLng(sePoint));
                  captureOrigins.push(nwPoint);
                  cells.push(bounds);
                }
              }
              
              for(const bounds of cells) {
                await new Promise(resolve => { map.once('moveend zoomend', resolve); map.fitBounds(bounds); });
                await awaitBothViews();
                const tCell = await terrainLayer.scene.screenshot();
                const wCell = await waterLayer.scene.screenshot();
                tCaptures.push(tCell.url);
                wCaptures.push(wCell.url);
              }

              map.fitBounds(originalBounds);
              
              stitchedTerrain.width = outputX; stitchedTerrain.height = outputY;
              stitchedWater.width = outputX; stitchedWater.height = outputY;
              const tCtx = stitchedTerrain.getContext("2d");
              const wCtx = stitchedWater.getContext("2d");
              
              for(let i = 0; i < tCaptures.length; i++) {
                await new Promise(r => { let img = new Image(); img.src = tCaptures[i]; img.onload = function() { tCtx.drawImage(img, captureOrigins[i].x * zoomFactor, captureOrigins[i].y * zoomFactor); r(); } });
                await new Promise(r => { let img = new Image(); img.src = wCaptures[i]; img.onload = function() { wCtx.drawImage(img, captureOrigins[i].x * zoomFactor, captureOrigins[i].y * zoomFactor); r(); } });
              }
          }

          const finalTerrainCanvas = document.createElement('canvas');
          const currentD = parseFloat(document.getElementById('map').style.width); 
          const pixelScale = stitchedTerrain.width / currentD; 

          finalTerrainCanvas.width = gui.mapWidth * pixelScale;
          finalTerrainCanvas.height = gui.mapHeight * pixelScale;
          const ftCtx = finalTerrainCanvas.getContext('2d');
          ftCtx.translate(finalTerrainCanvas.width / 2, finalTerrainCanvas.height / 2);
          ftCtx.rotate(gui.mapRotation * Math.PI / 180);
          ftCtx.drawImage(stitchedTerrain, -stitchedTerrain.width / 2, -stitchedTerrain.height / 2);

          const tBlob = await new Promise(resolve => finalTerrainCanvas.toBlob(resolve));
          saveAs(tBlob, '1_terrain_heightmap.png');

          const finalWaterCanvas = document.createElement('canvas');
          finalWaterCanvas.width = gui.mapWidth * pixelScale;
          finalWaterCanvas.height = gui.mapHeight * pixelScale;
          const fwCtx = finalWaterCanvas.getContext('2d');
          
          fwCtx.fillStyle = "#000000"; 
          fwCtx.fillRect(0, 0, finalWaterCanvas.width, finalWaterCanvas.height);
          
          fwCtx.translate(finalWaterCanvas.width / 2, finalWaterCanvas.height / 2);
          fwCtx.rotate(gui.mapRotation * Math.PI / 180);
          fwCtx.drawImage(stitchedWater, -stitchedWater.width / 2, -stitchedWater.height / 2);

          const wBlob = await new Promise(resolve => finalWaterCanvas.toBlob(resolve));
          saveAs(wBlob, '2_water_mask.png');

      } catch (error) {
          console.error("Export failed:", error);
          alert("Export failed. Check the developer console for errors.");
      } finally {
          waterLayer.scene.config.scene.background.color = [0.0, 0.0, 0.0, 0.0];
          await waterLayer.scene.updateConfig();
          waterLayer.scene.canvas.style.display = gui.show_water ? 'block' : 'none';

          gui.autoexpose = preRenderAutoExposureState;
      }
  }

  return map;
}());