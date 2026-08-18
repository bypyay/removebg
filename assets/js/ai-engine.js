/**
 * Daily1Step RemoveBG AI Studio — Real Neural Network In-Browser AI Engine
 * Powered by Google MediaPipe Selfie & Portrait Neural Segmentation (WASM / WebGL)
 * 100% In-Browser, Zero Server Upload, Ultra-Sharp 4K Cutouts.
 */

var RemoveBGStudio = (function() {
  'use strict';

  var originalImg = null;
  var originalCanvas = document.createElement('canvas');
  var maskCanvas = document.createElement('canvas');
  var renderCanvas = document.getElementById('mainCanvas');
  var renderCtx = renderCanvas ? renderCanvas.getContext('2d') : null;

  var selfieSegmentation = null;
  var isModelLoaded = false;

  var state = {
    bgType: 'transparent', // 'transparent', 'color', 'gradient', 'photo', 'blur'
    bgColor: '#ffffff',
    gradFrom: '#6366f1',
    gradTo: '#ec4899',
    bgImg: null,
    blurAmount: 20, // px
    
    // AI Edge Refinement
    edgeThreshold: 45, // 0 to 100
    edgeFeather: 2,
    
    // Brush
    brushMode: 'erase', // 'erase', 'restore'
    brushSize: 24,
    brushOpacity: 1.0,
    isDrawing: false,
    history: [],
    historyIndex: -1,
    
    // Shadow
    shadowEnabled: false,
    shadowBlur: 15,
    shadowOffsetY: 10,
    shadowOpacity: 0.35,
    
    // View
    viewMode: 'cutout', // 'cutout', 'split'
    zoom: 1.0
  };

  // ══════════════════════════════════════════════════════════════════
  // 1. INITIALIZE NEURAL NETWORK (MediaPipe WASM)
  // ══════════════════════════════════════════════════════════════════
  function initNeuralNetwork() {
    if (typeof SelfieSegmentation !== 'undefined') {
      try {
        selfieSegmentation = new SelfieSegmentation({
          locateFile: function(file) {
            return 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/' + file;
          }
        });

        selfieSegmentation.setOptions({
          modelSelection: 1, // 1 = landscape/higher accuracy deep neural model
          selfieMode: false
        });

        selfieSegmentation.onResults(onNeuralSegmentationResults);
        isModelLoaded = true;
        console.log("MediaPipe Neural Network ready!");
      } catch (err) {
        console.warn("MediaPipe init error:", err);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 2. DOM EVENT LISTENERS & INGESTION
  // ══════════════════════════════════════════════════════════════════
  function init() {
    initNeuralNetwork();

    var dropzone = document.getElementById('heroDropzone');
    var fileInput = document.getElementById('photoFileInput');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', function() { fileInput.click(); });

      dropzone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone.addEventListener('dragleave', function() {
        dropzone.classList.remove('dragover');
      });
      dropzone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleFile(e.dataTransfer.files[0]);
        }
      });

      fileInput.addEventListener('change', function(e) {
        if (e.target.files && e.target.files.length > 0) {
          handleFile(e.target.files[0]);
        }
      });
    }

    // Clipboard Paste Listener (Ctrl+V)
    window.addEventListener('paste', function(e) {
      if (e.clipboardData && e.clipboardData.items) {
        var items = e.clipboardData.items;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            var file = items[i].getAsFile();
            handleFile(file);
            break;
          }
        }
      }
    });

    initComparisonSlider();
    initBrushEvents();
  }

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      loadImage(ev.target.result);
    };
    reader.readAsDataURL(file);
  }

  window.loadSampleImage = function(src) {
    loadImage(src);
  };

  function loadImage(src) {
    showLoader(true);
    var img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = function() {
      originalImg = img;
      originalCanvas.width = img.naturalWidth;
      originalCanvas.height = img.naturalHeight;
      var oCtx = originalCanvas.getContext('2d');
      oCtx.drawImage(img, 0, 0);

      maskCanvas.width = img.naturalWidth;
      maskCanvas.height = img.naturalHeight;

      // Run MediaPipe AI Neural Network Segmentation
      runAISegmentation();
    };
    img.src = src;
  }

  // ══════════════════════════════════════════════════════════════════
  // 3. AI SEGMENTATION PIPELINE (Neural Net + Matte Refinement)
  // ══════════════════════════════════════════════════════════════════
  function runAISegmentation() {
    if (selfieSegmentation) {
      selfieSegmentation.send({ image: originalImg }).catch(function(err) {
        console.warn("Neural inference fallback:", err);
        fallbackColorSegmentation();
      });
    } else {
      fallbackColorSegmentation();
    }
  }

  function onNeuralSegmentationResults(results) {
    var W = originalCanvas.width;
    var H = originalCanvas.height;
    var mCtx = maskCanvas.getContext('2d');

    // Draw the neural probability mask from MediaPipe onto maskCanvas
    mCtx.clearRect(0, 0, W, H);
    mCtx.drawImage(results.segmentationMask, 0, 0, W, H);

    // Alpha Matte Refinement & High-Contrast Sigmoid Edge Sharpening
    var maskData = mCtx.getImageData(0, 0, W, H);
    var pixels = maskData.data;

    // Threshold cutoff value
    var lowCut = 30;
    var highCut = 190;

    for (var i = 0; i < pixels.length; i += 4) {
      var rawVal = pixels[i]; // MediaPipe writes probability in Red/Alpha channel
      var alpha = 0;

      if (rawVal >= highCut) {
        alpha = 255;
      } else if (rawVal <= lowCut) {
        alpha = 0;
      } else {
        // Smooth Hermite interpolation between low and high cut
        var t = (rawVal - lowCut) / (highCut - lowCut);
        alpha = Math.floor((t * t * (3 - 2 * t)) * 255);
      }

      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = alpha;
    }

    mCtx.putImageData(maskData, 0, 0);

    showLoader(false);
    showWorkspace(true);
    saveHistory();
    render();
  }

  // Fallback if WebGL/WASM unavailable
  function fallbackColorSegmentation() {
    var W = originalCanvas.width;
    var H = originalCanvas.height;
    var oCtx = originalCanvas.getContext('2d');
    var mCtx = maskCanvas.getContext('2d');

    var imgData = oCtx.getImageData(0, 0, W, H);
    var pixels = imgData.data;
    var maskData = mCtx.createImageData(W, H);
    var maskPixels = maskData.data;

    // Sample border colors
    var bgR = (pixels[0] + pixels[(W - 1) * 4] + pixels[((H - 1) * W) * 4]) / 3;
    var bgG = (pixels[1] + pixels[(W - 1) * 4 + 1] + pixels[((H - 1) * W) * 4 + 1]) / 3;
    var bgB = (pixels[2] + pixels[(W - 1) * 4 + 2] + pixels[((H - 1) * W) * 4 + 2]) / 3;

    var centerX = W / 2;
    var centerY = H / 2;

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var idx = (y * W + x) * 4;
        var r = pixels[idx];
        var g = pixels[idx+1];
        var b = pixels[idx+2];

        var d = Math.sqrt((r - bgR)*(r - bgR) + (g - bgG)*(g - bgG) + (b - bgB)*(b - bgB));
        var distCenter = Math.sqrt(Math.pow((x - centerX)/centerX, 2) + Math.pow((y - centerY)/centerY, 2));

        var alpha = 255;
        if (d < 45 && distCenter > 0.35) {
          alpha = 0;
        }

        maskPixels[idx] = 255;
        maskPixels[idx+1] = 255;
        maskPixels[idx+2] = 255;
        maskPixels[idx+3] = alpha;
      }
    }
    mCtx.putImageData(maskData, 0, 0);

    showLoader(false);
    showWorkspace(true);
    saveHistory();
    render();
  }

  // ══════════════════════════════════════════════════════════════════
  // 4. MASTER RENDER ENGINE
  // ══════════════════════════════════════════════════════════════════
  function render() {
    if (!originalImg || !renderCanvas) return;

    var W = originalCanvas.width;
    var H = originalCanvas.height;

    renderCanvas.width = W;
    renderCanvas.height = H;
    renderCtx.clearRect(0, 0, W, H);

    // 1. Draw Selected Background
    if (state.bgType === 'color') {
      renderCtx.fillStyle = state.bgColor;
      renderCtx.fillRect(0, 0, W, H);
    }
    else if (state.bgType === 'gradient') {
      var grad = renderCtx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, state.gradFrom);
      grad.addColorStop(1, state.gradTo);
      renderCtx.fillStyle = grad;
      renderCtx.fillRect(0, 0, W, H);
    }
    else if (state.bgType === 'photo' && state.bgImg) {
      renderCtx.drawImage(state.bgImg, 0, 0, W, H);
    }
    else if (state.bgType === 'blur') {
      renderCtx.save();
      renderCtx.filter = 'blur(' + state.blurAmount + 'px)';
      renderCtx.drawImage(originalImg, -20, -20, W + 40, H + 40);
      renderCtx.restore();
    }

    // 2. Draw Drop Shadow
    if (state.shadowEnabled) {
      renderCtx.save();
      renderCtx.shadowColor = 'rgba(0,0,0,' + state.shadowOpacity + ')';
      renderCtx.shadowBlur = state.shadowBlur;
      renderCtx.shadowOffsetY = state.shadowOffsetY;
      renderCutout(renderCtx, W, H);
      renderCtx.restore();
    }

    // 3. Draw Cutout Subject
    renderCutout(renderCtx, W, H);

    // 4. Update Split Comparison
    updateComparisonSliderImages();
  }

  function renderCutout(ctx, W, H) {
    var tempCanvas = document.createElement('canvas');
    tempCanvas.width = W;
    tempCanvas.height = H;
    var tCtx = tempCanvas.getContext('2d');

    // Draw original image
    tCtx.drawImage(originalImg, 0, 0);

    // Composite mask with destination-in
    tCtx.globalCompositeOperation = 'destination-in';
    tCtx.drawImage(maskCanvas, 0, 0);

    // Draw back onto render context
    ctx.drawImage(tempCanvas, 0, 0);
  }

  // ══════════════════════════════════════════════════════════════════
  // 5. BACKGROUND CONTROLLERS
  // ══════════════════════════════════════════════════════════════════
  window.setBgType = function(type) {
    state.bgType = type;
    render();
  };

  window.setSolidBg = function(hex, btn) {
    state.bgType = 'color';
    state.bgColor = hex;
    document.querySelectorAll('.swatch-btn').forEach(function(s) { s.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    render();
  };

  window.setGradientBg = function(from, to) {
    state.bgType = 'gradient';
    state.gradFrom = from;
    state.gradTo = to;
    render();
  };

  window.setPresetPhotoBg = function(url) {
    state.bgType = 'photo';
    var img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = function() {
      state.bgImg = img;
      render();
    };
    img.src = url;
  };

  window.updateBlurAmount = function(val) {
    state.bgType = 'blur';
    state.blurAmount = parseInt(val);
    var badge = document.getElementById('blurValBadge');
    if (badge) badge.textContent = val + 'px';
    render();
  };

  window.updateShadow = function() {
    state.shadowEnabled = document.getElementById('chkShadow') ? document.getElementById('chkShadow').checked : false;
    state.shadowBlur = parseInt(document.getElementById('shadowBlurRange') ? document.getElementById('shadowBlurRange').value : 15);
    state.shadowOffsetY = parseInt(document.getElementById('shadowOffsetRange') ? document.getElementById('shadowOffsetRange').value : 10);
    render();
  };

  // ══════════════════════════════════════════════════════════════════
  // 6. MANUAL ERASE & RESTORE BRUSH
  // ══════════════════════════════════════════════════════════════════
  function initBrushEvents() {
    if (!renderCanvas) return;

    renderCanvas.addEventListener('mousedown', function(e) {
      if (state.viewMode !== 'cutout') return;
      state.isDrawing = true;
      applyBrush(e);
    });

    window.addEventListener('mousemove', function(e) {
      if (state.isDrawing) {
        applyBrush(e);
      }
    });

    window.addEventListener('mouseup', function() {
      if (state.isDrawing) {
        state.isDrawing = false;
        saveHistory();
      }
    });
  }

  function applyBrush(e) {
    var rect = renderCanvas.getBoundingClientRect();
    var scaleX = maskCanvas.width / rect.width;
    var scaleY = maskCanvas.height / rect.height;
    var x = (e.clientX - rect.left) * scaleX;
    var y = (e.clientY - rect.top) * scaleY;

    var mCtx = maskCanvas.getContext('2d');
    mCtx.save();
    mCtx.beginPath();
    mCtx.arc(x, y, state.brushSize, 0, Math.PI * 2);

    if (state.brushMode === 'erase') {
      mCtx.globalCompositeOperation = 'destination-out';
      mCtx.fillStyle = 'rgba(0,0,0,1)';
      mCtx.fill();
    } else {
      mCtx.globalCompositeOperation = 'source-over';
      mCtx.fillStyle = 'rgba(255,255,255,1)';
      mCtx.fill();
    }
    mCtx.restore();

    render();
  }

  window.setBrushMode = function(mode, btn) {
    state.brushMode = mode;
    document.querySelectorAll('.btn-brush-mode').forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
  };

  window.updateBrushSize = function(val) {
    state.brushSize = parseInt(val);
    var badge = document.getElementById('brushSizeBadge');
    if (badge) badge.textContent = val + 'px';
  };

  function saveHistory() {
    var mCtx = maskCanvas.getContext('2d');
    var snapshot = mCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    state.historyIndex++;
  }

  window.undoBrush = function() {
    if (state.historyIndex > 0) {
      state.historyIndex--;
      var snapshot = state.history[state.historyIndex];
      var mCtx = maskCanvas.getContext('2d');
      mCtx.putImageData(snapshot, 0, 0);
      render();
    }
  };

  window.redoBrush = function() {
    if (state.historyIndex < state.history.length - 1) {
      state.historyIndex++;
      var snapshot = state.history[state.historyIndex];
      var mCtx = maskCanvas.getContext('2d');
      mCtx.putImageData(snapshot, 0, 0);
      render();
    }
  };

  // ══════════════════════════════════════════════════════════════════
  // 7. SPLIT COMPARISON SLIDER
  // ══════════════════════════════════════════════════════════════════
  function initComparisonSlider() {
    var divider = document.getElementById('compDivider');
    var wrap = document.getElementById('comparisonSliderWrap');
    if (!divider || !wrap) return;

    var isSliding = false;
    divider.addEventListener('mousedown', function() { isSliding = true; });
    window.addEventListener('mouseup', function() { isSliding = false; });

    window.addEventListener('mousemove', function(e) {
      if (!isSliding) return;
      var rect = wrap.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      divider.style.left = pct + '%';
      var afterWrap = document.getElementById('compAfterWrap');
      if (afterWrap) afterWrap.style.width = pct + '%';
    });
  }

  function updateComparisonSliderImages() {
    var beforeImg = document.getElementById('compBeforeImg');
    var afterImg = document.getElementById('compAfterImg');
    if (beforeImg && originalImg) beforeImg.src = originalImg.src;
    if (afterImg && renderCanvas) afterImg.src = renderCanvas.toDataURL();
  }

  window.setViewMode = function(mode, btn) {
    state.viewMode = mode;
    document.querySelectorAll('.prev-pill-btn').forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');

    var slider = document.getElementById('comparisonSliderWrap');
    var canvasEl = document.getElementById('mainCanvas');

    if (mode === 'split') {
      if (slider) slider.style.display = 'block';
      if (canvasEl) canvasEl.style.display = 'none';
      updateComparisonSliderImages();
    } else {
      if (slider) slider.style.display = 'none';
      if (canvasEl) canvasEl.style.display = 'block';
      render();
    }
  };

  // ══════════════════════════════════════════════════════════════════
  // 8. TAB SWITCHING
  // ══════════════════════════════════════════════════════════════════
  window.switchTab = function(tabId, btn) {
    document.querySelectorAll('.tab-edit-btn').forEach(function(b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-pane-content').forEach(function(p) { p.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    var pane = document.getElementById('pane-' + tabId);
    if (pane) pane.classList.add('active');
  };

  // ══════════════════════════════════════════════════════════════════
  // 9. 4K ULTRA HD EXPORT & DOWNLOAD
  // ══════════════════════════════════════════════════════════════════
  window.downloadImage = function(format) {
    if (!renderCanvas) return;
    var fmt = format || 'png';
    var mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    var ext = fmt === 'jpg' ? 'jpg' : 'png';

    var dataUrl = renderCanvas.toDataURL(mime, 0.98);
    var a = document.createElement('a');
    a.download = 'removebg-cutout-' + Date.now() + '.' + ext;
    a.href = dataUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ══════════════════════════════════════════════════════════════════
  // 10. UI HELPERS
  // ══════════════════════════════════════════════════════════════════
  function showLoader(show) {
    var loader = document.getElementById('aiProcessingModal');
    if (loader) loader.style.display = show ? 'flex' : 'none';
  }

  function showWorkspace(show) {
    var hero = document.getElementById('heroSection');
    var ws = document.getElementById('workspaceSection');
    if (hero) hero.style.display = show ? 'none' : 'block';
    if (ws) ws.style.display = show ? 'block' : 'none';
  }

  window.resetToUpload = function() {
    originalImg = null;
    showWorkspace(false);
  };

  document.addEventListener('DOMContentLoaded', init);

  return {
    init: init,
    loadImage: loadImage
  };
})();
