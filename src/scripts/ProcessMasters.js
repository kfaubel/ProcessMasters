// ======================================================================
// ProcessMasters.js
// A PixInsight JavaScript Runtime (PJSR) script for batch processing
// ======================================================================

// -----------------------------------------------------------------------
// PJSR PREPROCESSOR DIRECTIVES
// These directives register the script with PixInsight's scripting system
// -----------------------------------------------------------------------

// #feature-id: Registers script with unique ID and menu location
//   Format: UniqueID : MenuCategory > ScriptName
//   This places the script in: Script > ProcessLRGB
#feature-id    ProcessMasters : Treehouse Astro > ProcessMasters

// #feature-info: Brief description shown in PixInsight's Feature Scripts dialog
#feature-info  Process master images, combine RGB or SHO and remove stars.

// #feature-icon: Icon displayed next to script in menus
//   @script_icon_dir is a built-in variable pointing to the script's icon directory
//// #feature - icon./ ProcessLRGB.png

// -----------------------------------------------------------------------
// PJSR INCLUDE FILES
// These .jsh files provide constants and definitions for UI components
// Located in PixInsight's include directory (e.g., src/scripts/pjsr/)
// -----------------------------------------------------------------------
#include <pjsr/ColorSpace.jsh>   // ColorSpace_RGB, ColorSpace_Gray constants
#include <pjsr/FrameStyle.jsh>   // FrameStyle_Box, FrameStyle_Sunken, etc. for widget borders
#include <pjsr/SampleType.jsh>   // SampleType_Real, SampleType_Integer for image data types
#include <pjsr/Sizer.jsh>        // Sizer alignment constants
#include <pjsr/StdButton.jsh>    // StdButton_Ok, StdButton_Cancel constants
#include <pjsr/StdIcon.jsh>      // StdIcon_Information, StdIcon_Warning, etc.
#include <pjsr/TextAlign.jsh>    // TextAlign_Left, TextAlign_Center, TextAlign_Right

// -----------------------------------------------------------------------
// ProcessMasters
// The processing engine that handles the actual file operations.
// Separated from the UI for cleaner architecture (Model-View pattern).
// -----------------------------------------------------------------------
function ProcessMasters() {
    // Array to hold file paths selected by the user
    this.inputFiles = new Array;
    this.outputDirectory = "";

    // Process options - control additional processing steps
    this.runGraxpertBG = true;
    this.runBlurXterminatorCorrectOnly = true;
    this.runChannelCombination = true;
    this.runSPCC = true;
    this.runBlurXterminatorFull = true;
    this.runNoiseXterminator = true;
    this.runStarXterminator = true;
    this.runMultiscaleAdaptiveStretch = true;
    this.saveTIFFs = true;

    var allowedFilters = "LRGBSHO".split("");
    var windowsByFilter = {};
    var rgbWindow = null;
    var shoWindow = null;

    /**
     * Summary: Normalizes one opened master file by closing crop masks, mapping filter IDs, and saving renamed channel masters.
     * Input: filePath (String), windows (ImageWindow[]), dir (String),
     *        state (Object: { windowsByFilter: Object, lastWindow: ImageWindow|null, lastOutPath: String })
     *        - windowsByFilter maps filter letters (L,R,G,B,H,S,O) to ImageWindow references
     *        - lastWindow tracks the most recently processed non-crop window
     *        - lastOutPath tracks the last XISF path written for per-channel output
     * Output: ImageWindow|null (state.lastWindow after processing, or null on failure)
     */
    this.StripCropMaskAndRenameMaster = function (filePath, windows, dir, state) {
        var window = null;

        // ---------------------------------------------------------------
        // For each specified image:
        //   * Close any crop_mask window
        //   * Detect which filter it corresponds to based on the filename (L, R, G, B, H, S, O)
        //   * Rename the window to the filter letter for easier identification in the workspace
        //   * Save the cleaned file with the new name
        // ---------------------------------------------------------------
        for (var i = windows.length - 1; i >= 0; --i) {
            window = windows[i];
            console.noteln("Scanning: " + filePath  + " | Opened window: " + window.mainView.id);

            // ---------------------------------------------------------------
            // ImageWindow.mainView - Property
            // Returns the main View object of the window
            // A View represents the image data and has properties like:
            //   - id: The identifier string shown in PixInsight workspace
            //   - image: The actual Image object with pixel data
            // ---------------------------------------------------------------
            var id = window.mainView.id.toLowerCase();

            if (id.indexOf("crop_mask") >= 0) {
                // console.writeln() - Writes message to Process Console
                console.noteln("Closing crop_mask window");

                // ---------------------------------------------------------------
                // ImageWindow.forceClose() - PJSR ImageWindow API
                // Closes the window without saving, ignoring any modifications
                // Does not prompt user even if image has unsaved changes
                // Use window.close() if you want the "save changes?" prompt
                // ---------------------------------------------------------------
                window.forceClose();
                continue;
            }

            // window should now be the actual image we are looking for.  Check what
            // it should be called and then save that window to a new file with the correct name.

            // Regex to extract filter letter from WBPP naming convention
            // Example: "masterLight_BIN-1_FILTER-H_..." → captures "H"
            var filterRegex = /FILTER-([A-Za-z])/;

            var fileName = File.extractName(filePath);

            // Skip files that are already renamed (single letter names)
            if (/^[LRGBHSO]$/i.test(fileName))
                continue;

            var match = filterRegex.exec(fileName);
            if (!match) {
                console.noteln("Skipping (no FILTER- tag): " + fileName);
                continue;
            }

            var filter = match[1].toUpperCase();

            // Build output path: same directory, new filename
            var outPath = dir + "/" + filter + ".xisf";

            console.noteln("Saving image: " + fileName + " → " + filter + ".xisf");

            // Setting this renames the view in the workspace
            window.mainView.id = filter;

            // The title shown in the window's title bar
            window.windowTitle = filter;

            // If a file with the target name already exists, remove it before saving the new one
            if (File.exists(outPath))
                File.remove(outPath);

            // ---------------------------------------------------------------
            // ImageWindow.saveAs() - PJSR ImageWindow API
            // Saves the image to a new file path
            // ---------------------------------------------------------------
            if (!this.saveWindowAsXISF(window, outPath, "renamed master"))
                return null;

            if (allowedFilters.indexOf(filter) >= 0) {
                state.windowsByFilter[filter] = window;
            } else {
                console.warningln("Unexpected filter type: " + filter);
                return null;
            }

            state.lastWindow = window;
            state.lastOutPath = outPath;
        }

        return state.lastWindow;
    };

    /**
     * Summary: Finds the currently open image window that matches a given view ID.
     * Input: id (String)
     * Output: ImageWindow|null
     */
    this.findWindowById = function (id) {
        for (var i = 0; i < ImageWindow.windows.length; ++i) {
            var currentWindow = ImageWindow.windows[i];
            if (currentWindow.mainView.id === id) {
                return currentWindow;
            }
        }
        return null;
    };

    /**
     * Summary: Saves a window as XISF with consistent logging and failure handling.
     * Input: window (ImageWindow), outPath (String), description (String)
     * Output: Boolean (true on successful save)
     */
    this.saveWindowAsXISF = function (window, outPath, description) {
        // Centralized save wrapper so every write has consistent error handling.
        if (!window.saveAs(outPath, false, false, false, false)) {
            console.warningln("Failed to save " + description + ": " + outPath);
            return false;
        }

        return true;
    };

    /**
        * Summary: Appends a stage suffix to the window/file name and saves the stage result as XISF.
     * Input: window (ImageWindow), fileBaseName (String), stageSuffix (String), dir (String), description (String)
     * Output: String|null (next file base name, or null if save failed)
     */
    this.appendStageSuffixAndSave = function (window, fileBaseName, stageSuffix, dir, description) {
        // Keep window IDs and filenames in sync with stage-based suffixes.
        window.mainView.id += "_" + stageSuffix;
        var nextBaseName = fileBaseName + "_" + stageSuffix;
        var outPath = dir + "/" + nextBaseName + ".xisf";

        if (!this.saveWindowAsXISF(window, outPath, description))
            return null;

        return nextBaseName;
    };

    /**
     * Summary: Chooses a MultiscaleAdaptiveStretch mode from naming hints in a window ID.
     * Input: windowId (String)
     * Output: String ("general" | "starless" | "stars")
     */
    this.resolveStretchMode = function (windowId) {
        // MAS tuning mode is inferred from the result window naming convention.
        if (windowId.indexOf("_starless") >= 0)
            return "starless";
        if (windowId.indexOf("_stars") >= 0)
            return "stars";
        return "general";
    };

    /**
     * Summary: Runs shared final output steps (optional MAS and TIFF export) for a result window set.
     * Input: resultWindows (ImageWindow[]), dir (String)
     * Output: Boolean (true when all finalize steps succeed)
     */
    this.finalizeResultWindows = function (resultWindows, dir) {
        // Shared finalization stage for RGB/SHO/L outputs:
        // 1) Optional MultiscaleAdaptiveStretch
        // 2) Optional 16-bit TIFF export
        for (var i = 0; i < resultWindows.length; ++i) {
            var resultWindow = resultWindows[i];

            if (this.runMultiscaleAdaptiveStretch) {
                var mode = this.resolveStretchMode(resultWindow.mainView.id);
                if (mode === "starless") {
                    if (RunMultiscaleAdaptiveStretch(resultWindow, mode)) {
                        resultWindow.mainView.id += "_mas";
                        console.noteln("MultiscaleAdaptiveStretch completed successfully on: " + resultWindow.mainView.id);
                        var masOutPath = dir + "/" + resultWindow.mainView.id + ".xisf";
                        if (!this.saveWindowAsXISF(resultWindow, masOutPath, "MAS result"))
                            return false;
                    } else {
                        console.warningln("MultiscaleAdaptiveStretch failed on: " + resultWindow.mainView.id);
                        return false;
                    }
                } else if (mode === "stars") {
                    if (RunStarStretch(resultWindow, mode)) {
                        resultWindow.mainView.id += "_stretch";
                        console.noteln("StarStretch completed successfully on: " + resultWindow.mainView.id);
                        var stretchOutPath = dir + "/" + resultWindow.mainView.id + ".xisf";
                        if (!this.saveWindowAsXISF(resultWindow, stretchOutPath, "StarStretch result"))
                            return false;
                    } else {
                        console.warningln("StarStretch failed on: " + resultWindow.mainView.id);
                        return false;
                    }
                }
            }

            if (this.saveTIFFs) {
                console.noteln("Saving 16bit TIFF for: " + resultWindow.mainView.id);
                var tifOutPath = dir + "/" + resultWindow.mainView.id + ".tif";
                this.saveTIFF(resultWindow, tifOutPath);
            }
        }

        return true;
    };

    /**
     * Summary: Exports a non-destructive 16-bit TIFF copy by duplicating the source window first.
     * Input: window (ImageWindow), outPath (String)
     * Output: void
     */
    this.saveTIFF = function (window, outPath) {
        // Export on a duplicate so converting to 16-bit integer does not mutate the source window.
        var fallbackDir = File.extractDrive(outPath) + File.extractDirectory(outPath);
        var tifWindow = duplicateImageWindow(window, fallbackDir);
        if (tifWindow == null) {
            console.warningln("Could not create a duplicate window for TIFF export: " + outPath);
            return;
        }

        tifWindow.setSampleFormat(16, false); // bitsPerSample=16, floatSample=false

        if (!tifWindow.saveAs(outPath, false, false, false, false)) {
            console.warningln("Failed to save TIFF: " + outPath);
        }

        tifWindow.forceClose();
    };

    /**
     * Summary: Applies the configured RGB post-processing pipeline and returns generated result windows.
     * Input: rgbWindow (ImageWindow), dir (String)
     * Output: ImageWindow[]|null (processed result windows)
     */
    this.processRGBWindow = function (rgbWindow, dir) {
        console.noteln("Processing RGB window.");

        if (rgbWindow == null)
            return null;       

        var resultWindows = [rgbWindow];
        var fileBaseName = "RGB";

        if (this.runSPCC) {
            if (RunSPCC(rgbWindow)) {
                console.noteln("SPCC completed successfully.");

                fileBaseName = this.appendStageSuffixAndSave(rgbWindow, fileBaseName, "spcc", dir, "RGB SPCC result");
                if (fileBaseName == null)
                    return null;
            } else {
                console.warningln("SPCC failed on: " + rgbWindow.mainView.id + ". Aborting further processing.");
                return null;
            }
        }

        if (this.runBlurXterminatorFull) {
            if (RunBlurXterminatorFull(rgbWindow)) {
                console.noteln("BlurXTerminator full completed successfully on RGB image.");

                fileBaseName = this.appendStageSuffixAndSave(rgbWindow, fileBaseName, "bxt", dir, "RGB BlurXTerminator result");
                if (fileBaseName == null)
                    return null;
            } else {
                console.warningln("BlurXTerminator full failed on: " + rgbWindow.mainView.id + ". Aborting further processing.");
                return null;
            }
        }

        if (this.runNoiseXterminator) {
            if (RunNoiseXterminator(rgbWindow)) {
                console.noteln("NoiseXTerminator completed successfully on RGB image.");

                fileBaseName = this.appendStageSuffixAndSave(rgbWindow, fileBaseName, "nxt", dir, "RGB NoiseXTerminator result");
                if (fileBaseName == null)
                    return null;
            } else {
                console.warningln("NoiseXTerminator failed on: " + rgbWindow.mainView.id + ". Aborting further processing.");
                return null;
            }
        }

        if (this.runStarXterminator) {
            if (RunStarXterminator(rgbWindow, true)) {
                console.noteln("StarXTerminator completed successfully on RGB image.");
                rgbWindow.mainView.id += "_starless";
                var outPath = dir + "/" + fileBaseName + "_starless" + ".xisf";
                console.noteln("Saving RGB starless image: " + fileBaseName + "_starless" + ".xisf");
                if (!this.saveWindowAsXISF(rgbWindow, outPath, "RGB starless result"))
                    return null;

                var starsWindow = this.findWindowById(fileBaseName + "_stars");

                if (starsWindow) {                    
                    var starsFilename = fileBaseName + "_stars";
                    var outPath = dir + "/" + starsFilename + ".xisf";
                    console.noteln("Saving RGB stars image: " + starsFilename + ".xisf");
                    if (!this.saveWindowAsXISF(starsWindow, outPath, "RGB stars result"))
                        return null;
                    resultWindows.push(starsWindow);
                } else {
                    console.warningln("Could not find stars image created by StarXTerminator for RGB image.");
                }
            } else {
                console.warningln("StarXTerminator failed on: " + rgbWindow.mainView.id);
                return null;
            }
        }

        return resultWindows;
    };

    /**
     * Summary: Applies the configured SHO post-processing pipeline and returns generated result windows.
     * Input: shoWindow (ImageWindow), dir (String)
     * Output: ImageWindow[]|null (processed result windows)
     */
    this.processSHOWindow = function (shoWindow, dir) {
        console.noteln("Processing SHO window.");

        if (shoWindow == null)
            return null;

        var resultWindows = [shoWindow];
        var fileBaseName = "SHO";

        if (this.runBlurXterminatorFull) {
            if (RunBlurXterminatorFull(shoWindow)) {
                console.noteln("BlurXTerminator full completed successfully on SHO image.");

                fileBaseName = this.appendStageSuffixAndSave(shoWindow, fileBaseName, "bxt", dir, "SHO BlurXTerminator result");
                if (fileBaseName == null)
                    return null;
            } else {
                console.warningln("BlurXTerminator full failed on: " + shoWindow.mainView.id + ". Aborting further processing.");
                return null;
            }
        }        
        
        if (this.runNoiseXterminator) {
            if (RunNoiseXterminator(shoWindow)) {
                console.noteln("NoiseXTerminator completed successfully on SHO image.");
                fileBaseName = this.appendStageSuffixAndSave(shoWindow, fileBaseName, "nxt", dir, "SHO NoiseXTerminator result");
                if (fileBaseName == null)
                    return null;
            } else {
                console.warningln("NoiseXTerminator failed on: " + shoWindow.mainView.id + ". Aborting further processing.");
                return null;
            }
        }

        if (this.runStarXterminator) {
            if (RunStarXterminator(shoWindow, true)) {
                console.noteln("StarXTerminator completed successfully on SHO image.");
                shoWindow.mainView.id += "_starless";                
                var outPath = dir + "/" + fileBaseName + "_starless" + ".xisf";
                console.noteln("Saving SHO starless image: " + fileBaseName + "_starless" + ".xisf");
                if (!this.saveWindowAsXISF(shoWindow, outPath, "SHO starless result"))
                    return null;

                var starsWindow = this.findWindowById(fileBaseName + "_stars");

                if (starsWindow) {                    
                    var starsFilename = fileBaseName + "_stars";
                    var outPath = dir + "/" + starsFilename + ".xisf";
                    console.noteln("Saving SHO stars image: " + starsFilename + ".xisf");
                    if (!this.saveWindowAsXISF(starsWindow, outPath, "SHO stars result"))
                        return null;
                    resultWindows.push(starsWindow);
                } else {
                    console.warningln("Could not find stars image created by StarXTerminator for SHO image.");
                }
            } else {
                console.warningln("StarXTerminator failed on: " + shoWindow.mainView.id);
                return null;
            }
        }

        return resultWindows;
    };

    /**
     * Summary: Applies the configured luminance post-processing pipeline and returns generated result windows.
     * Input: luminanceWindow (ImageWindow), dir (String)
     * Output: ImageWindow[]|null (processed result windows)
     */
    this.processLWindow = function (luminanceWindow, dir) {
        console.noteln("Processing Luminance window.");

        if (luminanceWindow == null)
            return null;

        var resultWindows = [luminanceWindow];
        var fileBaseName = "L";

        if (this.runBlurXterminatorFull) {
            if (RunBlurXterminatorFull(luminanceWindow)) {
                console.noteln("BlurXTerminator full completed successfully on luminance window.");
                fileBaseName = this.appendStageSuffixAndSave(luminanceWindow, fileBaseName, "bxt", dir, "Luminance BlurXTerminator result");
                if (fileBaseName == null)
                    return null;
            } else {
                console.warningln("BlurXTerminator full failed on luminance window.");
                return null;
            }
        }

        if (this.runNoiseXterminator) {
            if (RunNoiseXterminator(luminanceWindow)) {
                console.noteln("NoiseXTerminator completed successfully on luminance window.");
                fileBaseName = this.appendStageSuffixAndSave(luminanceWindow, fileBaseName, "nxt", dir, "Luminance NoiseXTerminator result");
                if (fileBaseName == null)
                    return null;
            } else {
                console.warningln("NoiseXTerminator failed on luminance window.");
                return null;
            }
        }

        if (this.runStarXterminator) {
            if (RunStarXterminator(luminanceWindow, false)) {
                console.noteln("StarXTerminator completed successfully on luminance window.");
                luminanceWindow.mainView.id += "_starless";
                var outPath = dir + "/" + fileBaseName + "_starless" + ".xisf";
                if (!this.saveWindowAsXISF(luminanceWindow, outPath, "Luminance starless result"))
                    return null;

                var starsWindow = this.findWindowById(fileBaseName + "_stars");

                if (starsWindow) {                    
                    var starsFilename = fileBaseName + "_stars";
                    var outPath = dir + "/" + starsFilename + ".xisf";
                    console.noteln("Saving Luminance stars image: " + starsFilename + ".xisf");
                    if (!this.saveWindowAsXISF(starsWindow, outPath, "Luminance stars result"))
                        return null;
                    resultWindows.push(starsWindow);
                } else {
                    console.warningln("Could not find stars image created by StarXTerminator for Luminance image.");
                }
            } else {
                console.warningln("StarXTerminator failed on luminance window.");
                return null;
            }
        }

        return resultWindows;
    };

    /**
     * Summary: Opens and preprocesses all selected master files, then records normalized filter windows.
     * Input: none (uses this.inputFiles)
     * Output: String|null (output directory path)
     */
    this.processInputMasterFiles = function () {
        // Stage 1: open and normalize selected master inputs (rename/filter mapping)
        // and run per-channel preprocessing steps.
        if (this.inputFiles.length === 0) {
            console.warningln("No input files specified.  Aborting.");
            return null;
        }

        var dir = null;

        for (let inputFileIndex = 0; inputFileIndex < this.inputFiles.length; ++inputFileIndex) {
            var filePath = this.inputFiles[inputFileIndex];

            console.noteln("***** Processing file: " + filePath + " *****");

            console.show();

            if (!File.exists(filePath)) {
                console.errorln("File not found: " + filePath + ". Skipping.");
                return null;
            }

            console.noteln("Opening: " + filePath);
            var windows = ImageWindow.open(filePath);
            if (windows.length === 0) {
                console.warningln("Failed to open: " + filePath + ". Skipping.");
                return null;
            }

            if (dir === null) {
                var path = windows[0].filePath;
                if (!path || path.length === 0) {
                    console.warningln("Cannot determine the path for the image file: " + windows[0].mainView.id + ". Aborting.");
                    return null;
                }

                dir = File.extractDrive(path) + File.extractDirectory(path);
                console.noteln("Output directory set to: " + dir);
            }

            var processingState = {
                windowsByFilter: windowsByFilter,
                lastWindow: null,
                lastOutPath: ""
            };

            var window = this.StripCropMaskAndRenameMaster(filePath, windows, dir, processingState);
            if (window === null)
                return null;

            if (this.runGraxpertBG) {
                if (RunGraxpertBackgroundExtraction(window)) {
                    console.noteln("GraXpert background extraction completed successfully.");
                } else {
                    console.warningln("GraXpert failed on: " + window.mainView.id);
                    return null;
                }
            }

            if (this.runBlurXterminatorCorrectOnly) {
                if (RunBlurXterminatorCorrectOnly(window)) {
                    console.noteln("BlurXTerminator completed successfully.");
                } else {
                    console.warningln("BlurXTerminator failed on: " + window.mainView.id);
                    return null;
                }
            }

            if (!this.saveWindowAsXISF(window, processingState.lastOutPath, "per-channel processing result"))
                return null;

            console.noteln("Saved after per channel processing: " + processingState.lastOutPath);
            window.show();
        }

        console.noteln("***** Finished processing of individual channels.");
        return dir;
    };

    /**
     * Summary: Combines three channel IDs into a single named window and saves the combined XISF result.
     * Input: ch1 (String), ch2 (String), ch3 (String), combinedName (String), dir (String)
     * Output: ImageWindow|null (combined channel window)
     */
    this.combineChannelSet = function (ch1, ch2, ch3, combinedName, dir) {
        // Stage 2: combine three channel windows into a single RGB/SHO image.
        var combinedWindow = CombineChannels(ch1, ch2, ch3);
        if (combinedWindow == null) {
            console.warningln(combinedName + " channel combination failed.");
            return null;
        }

        combinedWindow.mainView.id = combinedName;
        combinedWindow.windowTitle = combinedName;
        var outPath = dir + "/" + combinedName + ".xisf";
        if (!this.saveWindowAsXISF(combinedWindow, outPath, combinedName + " combined result"))
            return null;

        return combinedWindow;
    };

    /**
     * Summary: Orchestrates the full workflow from per-channel preprocessing through optional combinations and finalization.
     * Input: none (uses configured options and loaded input files)
     * Output: void
     */
    this.processEachChannelMaster = function () {
        // Pipeline overview:
        // 1) Process individual channel masters
        // 2) Optionally combine RGB/SHO
        // 3) Run optional post-processing per output set
        // 4) Finalize outputs (MAS/TIFF) consistently
        var dir = this.processInputMasterFiles();
        if (dir == null)
            return;

        console.show(); // Ensure console is visible for the next steps since it sometimes closes on its own.

        // If we have R, G and B channels, combine them into an RGB image before running the rest of the processing steps. 
        // This could be our primary image or it may be used to generated stars for an SHO + RGB Stars composition.
        if (this.runChannelCombination && windowsByFilter["R"] && windowsByFilter["G"] && windowsByFilter["B"]) {
            rgbWindow = this.combineChannelSet("R", "G", "B", "RGB", dir);
            if (rgbWindow == null)
                return;
        }
        
        if (this.runChannelCombination && windowsByFilter["S"] && windowsByFilter["H"] && windowsByFilter["O"]) {
            shoWindow = this.combineChannelSet("S", "H", "O", "SHO", dir);
            if (shoWindow == null)
                return;
        } 

        console.show(); // Ensure console is visible for the next steps since it sometimes closes on its own.

        // If we have an rgbWindow, we can run the optional processing steps on it.
        if (rgbWindow) {
            var rgbResults = this.processRGBWindow(rgbWindow, dir);
            if (!rgbResults)
                return;
            if (!this.finalizeResultWindows(rgbResults, dir))
                return;
        }

        // If we have an shoWindow, we can run the optional processing steps on it.
        if (shoWindow) {
            var shoResults = this.processSHOWindow(shoWindow, dir);
            if (!shoResults)
                return;
            if (!this.finalizeResultWindows(shoResults, dir))
                return;
        }

        // Only process a luminance window if it was provided in the input files. This allows 
        // users to skip the luminance processing steps if they only have RGB channels.
        if (windowsByFilter["L"]) {
            var luminanceResults = this.processLWindow(windowsByFilter["L"], dir);
            if (!luminanceResults)
                return;

            if (!this.finalizeResultWindows(luminanceResults, dir))
                return;
        }

        console.noteln("*****   Processing complete.   *****");
    }
}

// -----------------------------------------------------------------------
// RunGraxpertBackgroundExtraction(engine)
// Function to run the background extraction process in a separate thread
// to keep the UI responsive. Not used in this script, but can be adapted

/**
 * Summary: Runs GraXpert background extraction on a target window.
 * Input: window (ImageWindow)
 * Output: Boolean (true if process executed)
 */
function RunGraxpertBackgroundExtraction(window) {
    console.noteln("Running GraXpert Background Extraction on " + window.mainView.id + ".");

    var P = new GraXpert;
    P.backgroundExtraction = true;
    P.smoothing = 0.0;
    P.correction = "Subtraction";
    P.createBackground = false;
    P.backgroundExtractionAIModel = "";
    P.denoising = false;
    P.strength = 1.00;
    P.batchSize = 4;
    P.denoiseAIModel = "";
    P.disableGPU = false;
    P.replaceImage = true;
    P.showLogs = false;
    P.appPath = "";
    P.deconvolution = false;
    P.deconvolutionMode = "Object-only";
    P.deconvolutionObjectStrength = 0.5;
    P.deconvolutionObjectPSFSize = 5.0;
    P.deconvolutionObjectAIModel = "";
    P.deconvolutionStarsAIModel = "";

    return P.executeOn(window.mainView);
}

/**
 * Summary: Runs BlurXTerminator in correct-only mode on a target window.
 * Input: window (ImageWindow)
 * Output: Boolean (true if process executed)
 */
function RunBlurXterminatorCorrectOnly(window) {
    console.noteln("Running BlurXTerminator Correct Only on " + window.mainView.id + ".");

    var P = new BlurXTerminator;
    P.ai_file = "BlurXTerminator.4.pb";
    P.correct_only = true;
    P.correct_first = false;
    P.nonstellar_then_stellar = false;
    P.lum_only = false;
    P.sharpen_stars = 0.50;
    P.adjust_halos = 0.00;
    P.nonstellar_psf_diameter = 0.00;
    P.auto_nonstellar_psf = true;
    P.sharpen_nonstellar = 0.50;

    return P.executeOn(window.mainView);
}

/**
 * Summary: Runs full BlurXTerminator deconvolution/sharpening on a target window.
 * Input: window (ImageWindow)
 * Output: Boolean (true if process executed)
 */
function RunBlurXterminatorFull(window) {
    console.noteln("Running BlurXTerminator Full on " + window.mainView.id + ".");
    
    var P = new BlurXTerminator;
    P.ai_file = "BlurXTerminator.4.pb";
    P.correct_only = false;
    P.correct_first = false;
    P.nonstellar_then_stellar = false;
    P.lum_only = false;
    P.sharpen_stars = 0.50;
    P.adjust_halos = 0.00;
    P.nonstellar_psf_diameter = 0.00;
    P.auto_nonstellar_psf = true;
    P.sharpen_nonstellar = 0.50;

    return P.executeOn(window.mainView);
}

/**
 * Summary: Runs NoiseXTerminator noise reduction on a target window.
 * Input: window (ImageWindow)
 * Output: Boolean (true if process executed)
 */
function RunNoiseXterminator(window) {
    console.noteln("Running NoiseXTerminator on " + window.mainView.id + ".");
    
    var P = new NoiseXTerminator;
    P.ai_file = "NoiseXTerminator.3.pb";
    P.enable_color_separation = false;
    P.enable_frequency_separation = false;
    P.denoise = 0.90;
    P.denoise_color = 0.90;
    P.denoise_lf = 0.9;
    P.denoise_lf_color = 0.9;
    P.frequency_scale = 5.0;
    P.iterations = 2;
    P.detail = 0.15;

    return P.executeOn(window.mainView);
}

/**
 * Summary: Runs StarXTerminator and controls whether stars are extracted/retained.
 * Input: window (ImageWindow), stars (Boolean)
 * Output: Boolean (true if process executed)
 */
function RunStarXterminator(window, stars) {
    console.noteln("Running StarXTerminator on " + window.mainView.id + ".");

    var P = new StarXTerminator;
    P.ai_file = "StarXTerminator.11.pb";
    P.stars = stars;
    P.unscreen = false;
    P.overlap = 0.50;

    console.noteln("Invoking StarXTerminator");
    return P.executeOn(window.mainView);
}

/**
 * Summary: Runs SpectrophotometricColorCalibration (SPCC) using the configured calibration profile.
 * Input: window (ImageWindow)
 * Output: Boolean (true if process executed)
 */
function RunSPCC(window) {
    console.noteln("Running SPCC on " + window.mainView.id + ".");

    var P = new SpectrophotometricColorCalibration;
    P.applyCalibration = true;
    P.narrowbandMode = false;
    P.narrowbandOptimizeStars = false;
    P.whiteReferenceSpectrum = "200.5,0.0715066,201.5,0.0689827,202.5,0.0720216,203.5,0.0685511,204.5,0.0712370,205.5,0.0680646,206.5,0.0683024,207.4,0.0729174,207.8,0.0702124,208.5,0.0727025,209.5,0.0688880,210.5,0.0690528,211.5,0.0697566,212.5,0.0705508,213.5,0.0654581,214.5,0.0676317,215.5,0.0699038,216.5,0.0674922,217.5,0.0668344,218.5,0.0661763,219.5,0.0690803,220.5,0.0670864,221.5,0.0635644,222.5,0.0619833,223.5,0.0668687,224.5,0.0640725,225.5,0.0614358,226.5,0.0628698,227.5,0.0649014,228.5,0.0673391,229.5,0.0638038,230.5,0.0643234,231.5,0.0614849,232.5,0.0493110,233.5,0.0574873,234.5,0.0555616,235.5,0.0609369,236.5,0.0557384,237.5,0.0578991,238.5,0.0536321,239.5,0.0575370,240.5,0.0555389,241.5,0.0571506,242.5,0.0615309,243.5,0.0595363,244.5,0.0634798,245.5,0.0628886,246.5,0.0622975,247.5,0.0600475,248.5,0.0608933,249.5,0.0580972,250.5,0.0653082,251.3,0.0576207,251.8,0.0588533,252.5,0.0566401,253.5,0.0582714,254.5,0.0575809,255.5,0.0633762,256.5,0.0610093,257.5,0.0652874,258.5,0.0642648,259.5,0.0632596,260.5,0.0609384,261.5,0.0600490,262.5,0.0636409,263.5,0.0682040,264.5,0.0754600,265.5,0.0806341,266.5,0.0699754,267.5,0.0739405,268.5,0.0755243,269.5,0.0697483,270.5,0.0736132,271.5,0.0678854,272.5,0.0663086,273.5,0.0709825,274.5,0.0602999,275.5,0.0630128,276.5,0.0669431,277.5,0.0701399,278.5,0.0641577,279.5,0.0511231,280.5,0.0550197,281.5,0.0692974,282.5,0.0753517,283.5,0.0723537,284.5,0.0679725,285.5,0.0634174,286.5,0.0742486,287.5,0.0783316,288.5,0.0771108,289.5,0.0801337,291,0.0914252,293,0.0862422,295,0.0838485,297,0.0858467,299,0.0865643,301,0.0875161,303,0.0893837,305,0.0905257,307,0.0935800,309,0.0934870,311,0.0982195,313,0.0953176,315,0.0961554,317,0.0995933,319,0.0924967,321,0.0978345,323,0.0907337,325,0.1054383,327,0.1143168,329,0.1135342,331,0.1106139,333,0.1119505,335,0.1099062,337,0.0967928,339,0.1022504,341,0.1039447,343,0.1063681,345,0.1091599,347,0.1109753,349,0.1181664,351,0.1232860,353,0.1163073,355,0.1267769,357,0.1035215,359,0.1042786,361,0.1176823,363,0.1219479,364,0.1250342,365,0.1363934,367,0.1407033,369,0.1288466,371,0.1379791,373,0.1127623,375,0.1318217,377,0.1528880,379,0.1670432,381,0.1727864,383,0.1243124,385,0.1639393,387,0.1724457,389,0.1520460,391,0.2043430,393,0.1427526,395,0.1870668,397,0.1244026,399,0.2329267,401,0.2556144,403,0.2542109,405,0.2491356,407,0.2379803,409,0.2541684,411,0.2279309,413,0.2533629,415,0.2557223,417,0.2584198,419,0.2560216,421,0.2587210,423,0.2498130,425,0.2609755,427,0.2495886,429,0.2412927,431,0.2182856,433,0.2579985,435,0.2483036,437,0.2928112,439,0.2713431,441,0.2828921,443,0.2975108,445,0.3012513,447,0.3161393,449,0.3221464,451,0.3585586,453,0.3219299,455,0.3334392,457,0.3568741,459,0.3412296,461,0.3498501,463,0.3424920,465,0.3478877,467,0.3611478,469,0.3560448,471,0.3456585,473,0.3587672,475,0.3690553,477,0.3657369,479,0.3671625,481,0.3666357,483,0.3761265,485,0.3466382,487,0.3121751,489,0.3651561,491,0.3688824,493,0.3627420,495,0.3786295,497,0.3733906,499,0.3510300,501,0.3338136,503,0.3540298,505,0.3527861,507,0.3680833,509,0.3507047,511,0.3597249,513,0.3486136,515,0.3372089,517,0.3152444,519,0.3257755,521,0.3499922,523,0.3744245,525,0.3907778,527,0.3490228,529,0.3972061,531,0.4203442,533,0.3740999,535,0.4084084,537,0.4070036,539,0.3993480,541,0.3942389,543,0.4010466,545,0.4128880,547,0.4055525,549,0.4094232,551,0.4053814,553,0.4201633,555,0.4269231,557,0.4193749,559,0.4105311,561,0.4257824,563,0.4239540,565,0.4310873,567,0.4218358,569,0.4360353,571,0.4229342,573,0.4583894,575,0.4425389,577,0.4481210,579,0.4320856,581,0.4507180,583,0.4645862,585,0.4513373,587,0.4516404,589,0.4033701,591,0.4466167,593,0.4513267,595,0.4524209,597,0.4613319,599,0.4546841,601,0.4499895,603,0.4631190,605,0.4724762,607,0.4724962,609,0.4569794,611,0.4599737,613,0.4363290,615,0.4488329,617,0.4267759,619,0.4545143,621,0.4514890,623,0.4384229,625,0.4256613,627,0.4470943,629,0.4565981,631,0.4458333,633,0.4533333,635,0.4546457,637,0.4535446,639,0.4638791,641,0.4561002,643,0.4617287,645,0.4594083,647,0.4597119,649,0.4517238,651,0.4686735,653,0.4686423,655,0.4544898,657,0.4255737,659,0.4640177,661,0.4711876,663,0.4679153,665,0.4689913,667,0.4592265,669,0.4668144,671,0.4498947,673,0.4629239,675,0.4559567,677,0.4596584,679,0.4549789,681,0.4586439,683,0.4653622,685,0.4543475,687,0.4632128,689,0.4711164,691,0.4709973,693,0.4685415,695,0.4696455,697,0.4769241,699,0.4760169,701,0.4701294,703,0.4815669,705,0.4850302,707,0.4707895,709,0.4570604,711,0.4465777,713,0.4382957,715,0.4379654,717,0.4446168,719,0.4350767,721,0.4466714,723,0.4579113,725,0.4625222,727,0.4669903,729,0.4615551,731,0.4763299,733,0.4793147,735,0.4857778,737,0.4997366,739,0.4915129,741,0.4926212,743,0.5062475,745,0.5072637,747,0.5170334,749,0.5173594,751,0.5244106,753,0.5344788,755,0.5397524,757,0.5387203,759,0.5280215,761,0.5191969,763,0.5085395,765,0.4984095,767,0.4749347,769,0.4878839,771,0.4798119,773,0.4821991,775,0.4799906,777,0.4870453,779,0.4928744,781,0.4934236,783,0.4904677,785,0.4849491,787,0.4947343,789,0.4890020,791,0.4789132,793,0.4822390,795,0.4795733,797,0.4973323,799,0.4988779,801,0.5054210,803,0.5087054,805,0.5103235,807,0.5187602,809,0.5151330,811,0.5223530,813,0.5396030,815,0.5475528,817,0.5543915,819,0.5380259,821,0.5321401,823,0.5366753,825,0.5372011,827,0.5440262,829,0.5390591,831,0.5212784,833,0.5187033,835,0.5197124,837,0.5241092,839,0.5070799,841,0.5253056,843,0.5003658,845,0.4896143,847,0.4910508,849,0.4964088,851,0.4753377,853,0.4986498,855,0.4604553,857,0.5174022,859,0.5105171,861,0.5175606,863,0.5322153,865,0.5335880,867,0.4811849,869,0.5241390,871,0.5458069,873,0.5508025,875,0.5423946,877,0.5580108,879,0.5677047,881,0.5580099,883,0.5649928,885,0.5629494,887,0.5384574,889,0.5523318,891,0.5614248,893,0.5521309,895,0.5550786,897,0.5583751,899,0.5597844,901,0.5394855,903,0.5638478,905,0.5862635,907,0.5877920,909,0.5774965,911,0.5866240,913,0.5989106,915,0.5958623,917,0.5964975,919,0.6041389,921,0.5797449,923,0.5607401,925,0.5640816,927,0.5704267,929,0.5642119,931,0.5694372,933,0.5716141,935,0.5705180,937,0.5618458,939,0.5736730,941,0.5630236,943,0.5796418,945,0.5720721,947,0.5873186,949,0.5896322,951,0.5794164,953,0.5828271,955,0.5692468,957,0.5808756,959,0.5949017,961,0.5875516,963,0.5923656,965,0.5824188,967,0.5838008,969,0.5948942,971,0.5865689,973,0.5818128,975,0.5807992,977,0.5851036,979,0.5775164,981,0.5938626,983,0.5885816,985,0.5943664,987,0.5911885,989,0.5916490,991,0.5868101,993,0.5919505,995,0.5945270,997,0.5960248,999,0.5950870,1003,0.5948938,1007,0.5888742,1013,0.6006343,1017,0.5958836,1022,0.6004154,1028,0.6050616,1032,0.5995678,1038,0.5984462,1043,0.6035475,1048,0.5973678,1052,0.5940806,1058,0.5854267,1063,0.5827191,1068,0.5788137,1072,0.5843356,1078,0.5830553,1082,0.5762549,1087,0.5766769,1092,0.5759526,1098,0.5726978,1102,0.5718654,1108,0.5658845,1113,0.5661672,1117,0.5637793,1122,0.5660178,1128,0.5608876,1133,0.5622964,1138,0.5603359,1143,0.5563605,1147,0.5652205,1153,0.5656560,1157,0.5607483,1162,0.5540304,1167,0.5556068,1173,0.5604768,1177,0.5492890,1183,0.5464411,1187,0.5385652,1192,0.5489344,1198,0.5331419,1203,0.5451093,1207,0.5419047,1212,0.5443417,1218,0.5477119,1223,0.5460783,1227,0.5435469,1232,0.5413216,1237,0.5419156,1243,0.5360791,1248,0.5363784,1253,0.5330056,1258,0.5330475,1262,0.5312735,1267,0.5282075,1272,0.5301258,1278,0.5318302,1283,0.5143390,1288,0.5259125,1292,0.5214670,1298,0.5287547,1302,0.5231621,1308,0.5267800,1313,0.5167545,1318,0.5170787,1323,0.5186867,1328,0.5111090,1332,0.5122823,1338,0.5085013,1343,0.5118057,1347,0.5086671,1352,0.5063367,1357,0.5007655,1363,0.5001648,1367,0.5036531,1373,0.5066053,1377,0.5064235,1382,0.5083958,1388,0.5053201,1393,0.4855558,1397,0.4835752,1402,0.4799809,1408,0.4854351,1412,0.4802711,1418,0.4867642,1423,0.4831264,1428,0.4768633,1433,0.4864127,1438,0.4916220,1442,0.4807589,1448,0.4908799,1452,0.4878666,1457,0.4919060,1462,0.4832121,1467,0.4817380,1472,0.4788120,1477,0.4832511,1483,0.4873623,1488,0.4833546,1492,0.4970729,1498,0.4941945,1503,0.4882672,1507,0.4906435,1512,0.5011545,1517,0.5042579,1522,0.5053326,1528,0.5103188,1533,0.5104235,1537,0.5109443,1543,0.5088747,1548,0.5114602,1552,0.5078479,1557,0.4955375,1562,0.5020681,1567,0.5009384,1572,0.5130484,1578,0.4843262,1583,0.4878957,1587,0.4869790,1593,0.5039261,1598,0.4961504,1605,0.5016433,1615,0.5109383,1625,0.5010374,1635,0.5166810,1645,0.4997573,1655,0.5132085,1665,0.5045445,1675,0.5038381,1685,0.4979366,1695,0.5024966,1705,0.4946397,1715,0.4900714,1725,0.4820987,1735,0.4704836,1745,0.4675962,1755,0.4610580,1765,0.4542064,1775,0.4442880,1785,0.4394009,1795,0.4305704,1805,0.4214249,1815,0.4154385,1825,0.4121445,1835,0.4087068,1845,0.4004347,1855,0.3981439,1865,0.3898276,1875,0.3819086,1885,0.3837946,1895,0.3719080,1905,0.3783857,1915,0.3734775,1925,0.3706359,1935,0.3625896,1945,0.3552610,1955,0.3559292,1965,0.3516581,1975,0.3442642,1985,0.3424439,1995,0.3401458,2005,0.3400624,2015,0.3370426,2025,0.3310865,2035,0.3294150,2045,0.3300824,2055,0.3263510,2065,0.3238343,2075,0.3226433,2085,0.3196882,2095,0.3156795,2105,0.3170735,2115,0.3129192,2125,0.3107151,2135,0.3111934,2145,0.3083829,2155,0.3053164,2165,0.3011248,2175,0.2987932,2185,0.2973707,2195,0.2953015,2205,0.2894185,2215,0.2910636,2225,0.2855524,2235,0.2835412,2245,0.2813240,2255,0.2794243,2265,0.2746838,2275,0.2752567,2285,0.2700351,2295,0.2315953,2305,0.2464873,2315,0.2460988,2325,0.2138361,2335,0.2290047,2345,0.2216595,2355,0.1997312,2365,0.2151513,2375,0.2079374,2385,0.1903472,2395,0.2020694,2405,0.1988067,2415,0.1834113,2425,0.1912983,2435,0.1873909,2445,0.1783537,2455,0.1759682,2465,0.1784857,2475,0.1715942,2485,0.1573562,2495,0.1568707,2505,0.1598265";
    P.whiteReferenceName = "Average Spiral Galaxy";
    P.redFilterTrCurve = "594,0,596,0.001,598,0.001,600,0.002,602,0.003,604,0.004,606,0.005,608,0.006,610,0.014,612,0.026,614,0.037,616,0.098,618,0.245,620,0.482,622,0.799,624,0.984,626,0.985,628,0.982,630,0.98,632,0.978,634,0.979,636,0.981,638,0.985,640,0.984,642,0.982,644,0.979,646,0.976,648,0.977,650,0.979,652,0.982,654,0.986,656,0.987,658,0.987,660,0.988,662,0.988,664,0.988,666,0.987,668,0.985,670,0.983,672,0.981,674,0.979,676,0.972,678,0.965,680,0.96,682,0.957,684,0.953,686,0.932,688,0.85,690,0.696,692,0.468,694,0.244,696,0.134,698,0.071,700,0.046,702,0.024,704,0.016,706,0.009,708,0.006,710,0.003,712,0.003,714,0.003,716,0.002,718,0.002,720,0.001";
    P.redFilterName = "Antlia V Pro Series R";
    P.greenFilterTrCurve = "480,0.001,482,0.004,484,0.009,486,0.018,488,0.053,490,0.151,492,0.357,494,0.628,496,0.908,498,0.974,500,0.975,502,0.971,504,0.968,506,0.964,508,0.961,510,0.965,512,0.972,514,0.98,516,0.982,518,0.98,520,0.97,522,0.964,524,0.96,526,0.963,528,0.967,530,0.976,532,0.981,534,0.978,536,0.975,538,0.97,540,0.965,542,0.964,544,0.968,546,0.971,548,0.972,550,0.971,552,0.972,554,0.975,556,0.974,558,0.942,560,0.832,562,0.669,564,0.429,566,0.264,568,0.143,570,0.075,572,0.037,574,0.02,576,0.012,578,0.008,580,0.005,582,0.004,584,0.002";
    P.greenFilterName = "Antlia V Pro Series G";
    P.blueFilterTrCurve = "420,0.002,422,0.006,424,0.021,426,0.088,428,0.237,430,0.418,432,0.611,434,0.795,436,0.925,438,0.964,440,0.968,442,0.964,444,0.962,446,0.957,448,0.954,450,0.957,452,0.966,454,0.97,456,0.971,458,0.973,460,0.978,462,0.977,464,0.975,466,0.969,468,0.959,470,0.956,472,0.955,474,0.961,476,0.966,478,0.968,480,0.964,482,0.957,484,0.965,486,0.965,488,0.962,490,0.956,492,0.966,494,0.966,496,0.963,498,0.956,500,0.966,502,0.968,504,0.838,506,0.653,508,0.431,510,0.201,512,0.095,514,0.05,516,0.023,518,0.012,520,0.007,522,0.004,524,0.002";
    P.blueFilterName = "Antlia V Pro Series B";
    P.redFilterWavelength = 656.3;
    P.redFilterBandwidth = 3.0;
    P.greenFilterWavelength = 500.7;
    P.greenFilterBandwidth = 3.0;
    P.blueFilterWavelength = 500.7;
    P.blueFilterBandwidth = 3.0;
    P.deviceQECurve = "1,1.0,500,1.0,1000,1.0,1500,1.0,2000,1.0,2500,1.0";
    P.deviceQECurveName = "Ideal QE curve";
    P.broadbandIntegrationStepSize = 0.50;
    P.narrowbandIntegrationSteps = 10;
    P.catalogId = "GaiaDR3SP";
    P.limitMagnitude = 12.00;
    P.autoLimitMagnitude = true;
    P.targetSourceCount = 8000;
    P.psfStructureLayers = 5;
    P.saturationThreshold = 0.75;
    P.saturationRelative = true;
    P.saturationShrinkFactor = 0.10;
    P.psfNoiseLayers = 1;
    P.psfHotPixelFilterRadius = 1;
    P.psfNoiseReductionFilterRadius = 0;
    P.psfMinStructureSize = 0;
    P.psfMinSNR = 40.00;
    P.psfAllowClusteredSources = true;
    P.psfType = SpectrophotometricColorCalibration.prototype.PSFType_Auto;
    P.psfGrowth = 1.25;
    P.psfMaxStars = 24576;
    P.psfSearchTolerance = 4.00;
    P.psfChannelSearchTolerance = 2.00;
    P.neutralizeBackground = true;
    P.backgroundReferenceViewId = "";
    P.backgroundLow = -2.80;
    P.backgroundHigh = 2.00;
    P.backgroundUseROI = false;
    P.backgroundROIX0 = 0;
    P.backgroundROIY0 = 0;
    P.backgroundROIX1 = 0;
    P.backgroundROIY1 = 0;
    P.generateGraphs = false;
    P.generateStarMaps = false;
    P.generateTextFiles = false;
    P.outputDirectory = "";

    console.noteln("Invoking SPCC");
    return P.executeOn(window.mainView);
}

// -----------------------------------------------------------------------  
// MultiscaleAdaptiveStretch
// A simple script to demonstrate how to use the MultiscaleAdaptiveStretch process
// to apply a multiscale stretch to an image.
// ------------------------------------------------------------------------
/**
 * Summary: Runs MultiscaleAdaptiveStretch using mode-specific parameter presets.
 * Input: window (ImageWindow), mode (String)
 * Output: Boolean (true if process executed)
 */
function RunMultiscaleAdaptiveStretch(window, mode) {
    console.noteln("Running MultiscaleAdaptiveStretch on " + window.mainView.id + ". Mode: " + mode);
    
    var P = new MultiscaleAdaptiveStretch;
    P.aggressiveness = 0.50;
    P.targetBackground = 0.150;
    P.dynamicRangeCompression = 0.40;
    P.contrastRecovery = true;
    P.scaleSeparation = 1024;
    P.contrastRecoveryIntensity = 1.000;
    P.previewLargeScale = false;
    P.saturationEnabled = true;
    P.saturationAmount = 0.75;
    P.saturationBoost = 0.50;
    P.saturationLightnessMask = true;
    P.backgroundROIEnabled = false;
    P.backgroundROIX0 = 0;
    P.backgroundROIY0 = 0;
    P.backgroundROIWidth = 0;
    P.backgroundROIHeight = 0;

    if (mode === "general") {
        // Default settings are good for general use
    } else if (mode === "stars") {
        P.contrastRecovery = false;
        P.dynamicRangeCompression = 1.0;
        P.saturationAmount = 0.40;
    } else if (mode === "starless") {
        P.aggressiveness = 0.65;    
        P.dynamicRangeCompression = 0.0;        
        P.saturationAmount = 0.75;
    } else {
        console.warningln("Unknown mode: " + mode + ". Using default settings.");
    }

    console.noteln("Invoking MultiscaleAdaptiveStretch");
    return P.executeOn(window.mainView);
}

/**
 * 
 * @param {*} window 
 * @returns 
 */
function RunStarStretch(window) {
    console.noteln("Running StarStretch on " + window.mainView.id + ".");
    var P = new MaskedStretch;
    P.targetBackground = 0.08000000;
    P.numberOfIterations = 100;
    P.clippingFraction = 0.00010000;
    P.backgroundReferenceViewId = "";
    P.backgroundLow = 0.00000000;
    P.backgroundHigh = 0.04000000;
    P.useROI = true;
    P.roiX0 = 10;
    P.roiY0 = 10;
    P.roiX1 = 110;
    P.roiY1 = 110;
    P.maskType = MaskedStretch.prototype.MaskType_Intensity;
    return P.executeOn(window.mainView);
}

/**
 * Summary: Builds a new RGB or SHO image from three source channel IDs via ChannelCombination.
 * Input: ch1 (String), ch2 (String), ch3 (String)
 * Output: ImageWindow|null (newly created combined window)
 */
function CombineChannels(ch1, ch2, ch3) {
    console.noteln("Running ChannelCombination on " + ch1 + ", " + ch2 + ", " + ch3 + ".");
    
    var P = new ChannelCombination;
    P.colorSpace = ChannelCombination.prototype.RGB;
    P.channels = [ // enabled, id
        [true, ch1],
        [true, ch2],
        [true, ch3]
    ];
    P.inheritAstrometricSolution = true;

    // Snapshot existing window IDs before combining so we can find the new one after
    var existingIds = {};
    for (var i = 0; i < ImageWindow.windows.length; ++i)
        existingIds[ImageWindow.windows[i].mainView.id] = true;

    if (!P.executeGlobal())
        return null;

    // The new window is whichever one wasn't in the snapshot
    for (var i = 0; i < ImageWindow.windows.length; ++i) {
        var w = ImageWindow.windows[i];
        if (!existingIds[w.mainView.id])
            return w;
    }

    return null; // shouldn't happen if executeGlobal() succeeded
}

/**
 * Summary: Creates a duplicate of a window, using a temporary fallback file when needed.
 * Input: sourceWindow (ImageWindow), fallbackDir (String)
 * Output: ImageWindow|null (duplicate window)
 */
function duplicateImageWindow(sourceWindow, fallbackDir) {
    if (sourceWindow == null)
        return null;

    var sourcePath = sourceWindow.filePath;

    if (!sourcePath || sourcePath.length === 0 || !File.exists(sourcePath)) {
        if (!fallbackDir || fallbackDir.length === 0) {
            console.warningln("Cannot duplicate window without a valid source path: " + sourceWindow.mainView.id);
            return null;
        }

        sourcePath = fallbackDir + "/__dup_" + sourceWindow.mainView.id + "_" + Date.now().toString() + ".xisf";
        if (!sourceWindow.saveAs(sourcePath, false, false, false, false)) {
            console.warningln("Failed to create fallback duplicate source file: " + sourcePath);
            return null;
        }
    }

    var windows = ImageWindow.open(sourcePath);
    if (windows.length === 0) {
        console.warningln("Failed to duplicate window: " + sourcePath);
        if (sourcePath != sourceWindow.filePath && File.exists(sourcePath))
            File.remove(sourcePath);
        return null;
    }

    if (sourcePath != sourceWindow.filePath && File.exists(sourcePath))
        File.remove(sourcePath);

    return windows[0];
}

// -----------------------------------------------------------------------
// ProcessMastersDialog
// The user interface dialog for this script.
// Extends the PJSR Dialog class using prototype inheritance.
//
// PJSR UI Architecture:
//   - Dialogs contain Controls (widgets)
//   - Controls are arranged using Sizers (layout managers)
//   - Events are handled via callback properties (onClick, etc.)
// -----------------------------------------------------------------------
/**
 * Summary: Constructs and wires the main ProcessMasters dialog UI and option bindings.
 * Input: engine (ProcessMasters)
 * Output: Dialog instance (via constructor/prototype pattern)
 */
function ProcessMastersDialog(engine) {
    // ---------------------------------------------------------------
    // PJSR Inheritance Pattern
    // This is how you extend built-in PJSR classes like Dialog
    // Must call both __base__ assignment and __base__() constructor
    // ---------------------------------------------------------------
    this.__base__ = Dialog;
    this.__base__();

    // Store reference to engine for use in event handlers
    this.engine = engine;

    // Script metadata
    this.version = "1.0.4";
    this.title = "ProcessMasters";
    this.author = "Ken Faubel";
    this.copyright = "2026";

    // ---------------------------------------------------------------
    // Label Widget - PJSR Control
    // A text display widget (non-editable)
    //
    // Constructor: new Label(parent)
    //   parent - The parent control (usually 'this' for the dialog)
    //
    // Key Properties:
    //   text          - The text to display (can include HTML if useRichText=true)
    //   wordWrapping  - Enable automatic line wrapping
    //   useRichText   - Enable HTML formatting in text
    //   frameStyle    - Border style (FrameStyle_Box, FrameStyle_Sunken, etc.)
    //   margin        - Internal padding in pixels
    //   textAlignment - TextAlign_Left, TextAlign_Center, TextAlign_Right
    // ---------------------------------------------------------------
    this.helpLabel = new Label(this);

    // FrameStyle_Box draws a simple rectangular border around the label
    this.helpLabel.frameStyle = FrameStyle_Box;

    // ---------------------------------------------------------------
    // Dialog.logicalPixelsToPhysical(pixels) - PJSR Dialog API
    // Converts logical pixels to physical pixels for DPI scaling
    // Use this for consistent appearance on high-DPI displays
    // Related: scaledResource() for icons, setScaledMinSize() for widgets
    // ---------------------------------------------------------------
    this.helpLabel.margin = 4;
    this.helpLabel.wordWrapping = true;
    this.helpLabel.useRichText = true;  // Enable HTML tags in text
    this.helpLabel.text = "<p><b>" + this.title + " v" + this.version + "</b> <p>" +
        "A tool to open WBPP master files, delete the crop_masks and rename the images with their filter name (H .xisf)</p>" +
        "<p>Copyright &copy; " + this.copyright + " " + this.author + "</p>";

    // ---------------------------------------------------------------
    // TreeBox Widget - PJSR Control
    // A list/tree widget for displaying hierarchical or flat data
    // Commonly used in PixInsight scripts for file lists
    //
    // Constructor: new TreeBox(parent)
    //
    // Key Properties:
    //   multipleSelection  - Allow selecting multiple items
    //   rootDecoration     - Show expand/collapse icons for tree nodes
    //   alternateRowColor  - Alternate background colors for readability
    //   numberOfColumns    - Number of columns in the tree
    //   headerVisible      - Show/hide column headers
    //   numberOfChildren   - Count of child nodes (read-only)
    //
    // Key Methods:
    //   setScaledMinSize(w, h) - Set minimum size with DPI scaling
    //   clear()                - Remove all nodes
    //   child(index)           - Get child node at index
    //   remove(index)          - Remove child at index
    // ---------------------------------------------------------------
    this.files_TreeBox = new TreeBox(this);
    this.files_TreeBox.multipleSelection = true;   // Allow Ctrl+click selection
    this.files_TreeBox.rootDecoration = false;     // Flat list, no tree expand icons
    this.files_TreeBox.alternateRowColor = true;   // Zebra striping for readability

    // ---------------------------------------------------------------
    // Control.setScaledMinSize(width, height) - PJSR Control API
    // Sets minimum widget size in logical pixels (DPI-aware)
    // The actual size will scale based on display DPI settings
    // ---------------------------------------------------------------
    this.files_TreeBox.setScaledMinSize(800, 160);  // Minimum size of TreeBox (width x height) - 160 should give us 8 items
    this.files_TreeBox.numberOfColumns = 1;
    this.files_TreeBox.headerVisible = false;

    // Populate TreeBox with any pre-existing input files
    for (let i = 0; i < this.engine.inputFiles.length; ++i) {
        // ---------------------------------------------------------------
        // TreeBoxNode - PJSR Object
        // Represents a row/item in a TreeBox
        //
        // Constructor: new TreeBoxNode(parentTreeBox)
        //   - Automatically adds the node to the parent TreeBox
        //
        // Key Methods:
        //   setText(column, text) - Set text for a specific column
        //   text(column)          - Get text from a specific column
        //
        // Key Properties:
        //   selected              - Whether this node is selected
        //   checked               - Checkbox state (if checkable)
        // ---------------------------------------------------------------
        let node = new TreeBoxNode(this.files_TreeBox);
        node.setText(0, this.engine.inputFiles[i]);  // Column 0
    }

    // ---------------------------------------------------------------
    // PushButton Widget - PJSR Control
    // A clickable button widget
    //
    // Constructor: new PushButton(parent)
    //
    // Key Properties:
    //   text     - Button label text
    //   icon     - Button icon (use scaledResource for DPI-aware icons)
    //   toolTip  - Hover tooltip text (supports HTML)
    //   enabled  - Enable/disable the button
    //
    // Key Events:
    //   onClick  - Callback function when button is clicked
    //              Inside callback, 'this' refers to the button
    //              Use 'this.dialog' to access parent dialog
    // ---------------------------------------------------------------
    this.filesAdd_Button = new PushButton(this);
    this.filesAdd_Button.text = "Add";

    // ---------------------------------------------------------------
    // Control.scaledResource(resourcePath) - PJSR Control API
    // Loads a DPI-aware resource (icon) from PixInsight's resource system
    // Built-in icons use ":/icons/name.png" format
    //
    // Common built-in icons:
    //   :/icons/add.png, :/icons/delete.png, :/icons/clear.png
    //   :/icons/ok.png, :/icons/cancel.png
    //   :/icons/folder.png, :/icons/file.png
    //   :/icons/arrow-up.png, :/icons/arrow-down.png
    // ---------------------------------------------------------------
    this.filesAdd_Button.icon = this.scaledResource(":/icons/add.png");
    this.filesAdd_Button.toolTip = "<p>Add image files to the input images list.</p>";

    // ---------------------------------------------------------------
    // Event Handler Pattern in PJSR
    // Assign a function to onClick property
    // Inside the handler:
    //   - 'this' refers to the widget that triggered the event
    //   - 'this.dialog' refers to the parent Dialog
    //   - Access other widgets via this.dialog.widgetName
    // ---------------------------------------------------------------
    this.filesAdd_Button.onClick = function () {
        // ---------------------------------------------------------------
        // OpenFileDialog - PJSR Dialog Class
        // Native file picker dialog for selecting files to open
        //
        // Constructor: new OpenFileDialog
        //
        // Key Properties:
        //   multipleSelections - Allow selecting multiple files
        //   caption            - Dialog title bar text
        //   initialPath        - Starting directory
        //   fileNames          - Array of selected file paths (after execute)
        //
        // Key Methods:
        //   loadImageFilters() - Set filters to supported image formats
        //   execute()          - Show dialog; returns true if OK clicked
        //
        // Related: SaveFileDialog for saving files
        // ---------------------------------------------------------------
        let ofd = new OpenFileDialog;
        ofd.multipleSelections = true;
        ofd.caption = "Select Images";

        // loadImageFilters() populates the file type dropdown with
        // all image formats PixInsight can read (XISF, FITS, TIFF, etc.)
        ofd.loadImageFilters();

        // execute() shows the dialog modally
        // Returns true if user clicked OK, false if cancelled
        if (ofd.execute()) {
            // ---------------------------------------------------------------
            // TreeBox.canUpdate - Property
            // Set to false before batch modifications to prevent UI flicker
            // Set back to true after modifications to refresh display
            // Improves performance when adding/removing many items
            // ---------------------------------------------------------------
            this.dialog.files_TreeBox.canUpdate = false;

            for (let i = 0; i < ofd.fileNames.length; ++i) {
                let node = new TreeBoxNode(this.dialog.files_TreeBox);
                node.setText(0, ofd.fileNames[i]);
                this.dialog.engine.inputFiles.push(ofd.fileNames[i]);
            }

            this.dialog.files_TreeBox.canUpdate = true;
        }
    };

    this.filesClear_Button = new PushButton(this);
    this.filesClear_Button.text = "Clear";
    this.filesClear_Button.icon = this.scaledResource(":/icons/clear.png");
    this.filesClear_Button.toolTip = "<p>Clear the list of input images.</p>";
    this.filesClear_Button.onClick = function () {
        // TreeBox.clear() - Removes all nodes from the TreeBox
        this.dialog.files_TreeBox.clear();
        // Reset the array length to 0 (clears array contents)
        this.dialog.engine.inputFiles.length = 0;
    };


    this.filesRemove_Button = new PushButton(this);
    this.filesRemove_Button.text = "Remove Selected";
    this.filesRemove_Button.icon = this.scaledResource(":/icons/delete.png");
    this.filesRemove_Button.toolTip = "<p>Remove all selected images from the input images list.</p>";
    this.filesRemove_Button.onClick = function () {
        // Rebuild the inputFiles array, excluding selected items
        this.dialog.engine.inputFiles.length = 0;
        for (let i = 0; i < this.dialog.files_TreeBox.numberOfChildren; ++i)
            if (!this.dialog.files_TreeBox.child(i).selected)
                this.dialog.engine.inputFiles.push(this.dialog.files_TreeBox.child(i).text(0));

        // Remove selected nodes from TreeBox (iterate backwards for safe removal)
        for (let i = this.dialog.files_TreeBox.numberOfChildren; --i >= 0;)
            if (this.dialog.files_TreeBox.child(i).selected)
                this.dialog.files_TreeBox.remove(i);
    };

    // ---------------------------------------------------------------
    // HorizontalSizer - PJSR Layout Manager
    // Arranges child widgets horizontally (left to right)
    //
    // Constructor: new HorizontalSizer
    //
    // Key Properties:
    //   margin   - Outer margin around all contents (pixels)
    //   spacing  - Space between adjacent widgets (pixels)
    //
    // Key Methods:
    //   add(widget)          - Add widget (sized to minimum)
    //   add(widget, stretch) - Add widget with stretch factor
    //                          0 = fixed size, >0 = expandable
    //   addStretch()         - Add flexible empty space
    //   addSpacing(pixels)   - Add fixed empty space
    //
    // Related: VerticalSizer for top-to-bottom arrangement
    // ---------------------------------------------------------------
    this.filesButtons_Sizer = new HorizontalSizer;
    this.filesButtons_Sizer.spacing = 4;  // 4 pixels between buttons
    this.filesButtons_Sizer.add(this.filesAdd_Button);

    // ---------------------------------------------------------------
    // Sizer.addStretch() - PJSR Sizer API
    // Adds flexible empty space that expands to fill available room
    // Use to push widgets apart or align them to edges
    // Optional parameter: stretch factor (default 1)
    //   addStretch(2) expands twice as much as addStretch(1)
    // ---------------------------------------------------------------
    this.filesButtons_Sizer.addStretch();  // Pushes Clear/Remove to the right
    this.filesButtons_Sizer.add(this.filesClear_Button);

    // ---------------------------------------------------------------
    // Sizer.addSpacing(pixels) - PJSR Sizer API
    // Adds fixed empty space of specified pixel width/height
    // Unlike addStretch(), this space does not expand
    // ---------------------------------------------------------------
    this.filesButtons_Sizer.addSpacing(10);
    this.filesButtons_Sizer.add(this.filesRemove_Button);

    // ---------------------------------------------------------------
    // GroupBox Widget - PJSR Control
    // A container widget with a titled border
    // Groups related controls together visually
    //
    // Constructor: new GroupBox(parent)
    //
    // Key Properties:
    //   title  - Text displayed in the group border
    //   sizer  - The layout manager for contents (must be assigned)
    // ---------------------------------------------------------------
    this.files_GroupBox = new GroupBox(this);
    this.files_GroupBox.title = "Input Images";

    // ---------------------------------------------------------------
    // VerticalSizer - PJSR Layout Manager
    // Arranges child widgets vertically (top to bottom)
    // Same API as HorizontalSizer, different direction
    // ---------------------------------------------------------------
    this.files_GroupBox.sizer = new VerticalSizer;
    this.files_GroupBox.sizer.margin = 6;   // Padding inside GroupBox
    this.files_GroupBox.sizer.spacing = 4;  // Space between TreeBox and buttons

    // ---------------------------------------------------------------
    // Sizer.add(widget, stretchFactor) - PJSR Sizer API
    // Adds widget to the layout with optional stretch factor
    //   stretchFactor = 0  : Widget uses minimum size only
    //   stretchFactor > 0  : Widget expands to fill available space
    //   stretchFactor = 100: Common value for "take all remaining space"
    // Stretch is proportional: factor 2 gets twice the space as factor 1
    // ---------------------------------------------------------------
    this.files_GroupBox.sizer.add(this.files_TreeBox, 100);  // TreeBox expands
    this.files_GroupBox.sizer.add(this.filesButtons_Sizer);  // Buttons fixed height

    // ---------------------------------------------------------------
    // Process Options Section
    // CheckBox widgets for controlling additional processing steps
    // ---------------------------------------------------------------

    // ---------------------------------------------------------------
    // CheckBox Widget - PJSR Control
    // A toggle button with a text label
    //
    // Constructor: new CheckBox(parent)
    //
    // Key Properties:
    //   text     - Label text displayed next to the checkbox
    //   checked  - Boolean state (true = checked, false = unchecked)
    //   toolTip  - Hover tooltip text
    //
    // Key Events:
    //   onCheck  - Callback when checkbox state changes
    //              Receives: checked (Boolean) parameter
    // ---------------------------------------------------------------
    this.runGraxpertBG_CheckBox = new CheckBox(this);
    this.runGraxpertBG_CheckBox.text = "Run Graxpert Background Extraction";
    this.runGraxpertBG_CheckBox.checked = this.engine.runGraxpertBG;
    this.runGraxpertBG_CheckBox.toolTip = "<p>Enable Graxpert Background Extraction.</p>";
    this.runGraxpertBG_CheckBox.onCheck = function (checked) {
        this.dialog.engine.runGraxpertBG = checked;
    };

    this.runBlurXterminatorCorrectOnly_CheckBox = new CheckBox(this);
    this.runBlurXterminatorCorrectOnly_CheckBox.text = "Run BlurXTerminator (Correct Only)";
    this.runBlurXterminatorCorrectOnly_CheckBox.checked = this.engine.runBlurXterminatorCorrectOnly;
    this.runBlurXterminatorCorrectOnly_CheckBox.toolTip = "<p>Enable BlurXTerminator (Correct Only).</p>";
    this.runBlurXterminatorCorrectOnly_CheckBox.onCheck = function (checked) {
        this.dialog.engine.runBlurXterminatorCorrectOnly = checked;
    };

    this.runBlurXterminatorFull_CheckBox = new CheckBox(this);
    this.runBlurXterminatorFull_CheckBox.text = "Run BlurXTerminator (Full)";
    this.runBlurXterminatorFull_CheckBox.checked = this.engine.runBlurXterminatorFull;
    this.runBlurXterminatorFull_CheckBox.toolTip = "<p>Enable BlurXterminator (Full).</p>";
    this.runBlurXterminatorFull_CheckBox.onCheck = function (checked) {
        this.dialog.engine.runBlurXterminatorFull = checked;
    };

    this.runSPCC_CheckBox = new CheckBox(this);
    this.runSPCC_CheckBox.text = "Run SPCC (if RGB image detected)";
    this.runSPCC_CheckBox.checked = this.engine.runSPCC;
    this.runSPCC_CheckBox.toolTip = "<p>Enable SPCC.</p>";
    this.runSPCC_CheckBox.onCheck = function (checked) {
        this.dialog.engine.runSPCC = checked;
    };

    this.runChannelCombination_CheckBox = new CheckBox(this);
    this.runChannelCombination_CheckBox.text = "Run Channel Combination (R+G+B or S+H+O)";
    this.runChannelCombination_CheckBox.checked = this.engine.runChannelCombination;
    this.runChannelCombination_CheckBox.toolTip = "<p>Enable Channel Combination.</p>";
    this.runChannelCombination_CheckBox.onCheck = function (checked) {
        this.dialog.engine.runChannelCombination = checked;
    };

    this.runNoiseXterminator_CheckBox = new CheckBox(this);
    this.runNoiseXterminator_CheckBox.text = "Run NoiseXTerminator";
    this.runNoiseXterminator_CheckBox.checked = this.engine.runNoiseXterminator;
    this.runNoiseXterminator_CheckBox.toolTip = "<p>Enable NoiseXTerminator.</p>";
    this.runNoiseXterminator_CheckBox.onCheck = function (checked) {
        this.dialog.engine.runNoiseXterminator = checked;
    };

    this.runStarXterminator_CheckBox = new CheckBox(this);
    this.runStarXterminator_CheckBox.text = "Run StarXterminator";
    this.runStarXterminator_CheckBox.checked = this.engine.runStarXterminator;
    this.runStarXterminator_CheckBox.toolTip = "<p>Enable StarXterminator.</p>";
    this.runStarXterminator_CheckBox.onCheck = function (checked) {
        this.dialog.engine.runStarXterminator = checked;
    };

    this.runMultiscaleAdaptiveStretch_CheckBox = new CheckBox(this);
    this.runMultiscaleAdaptiveStretch_CheckBox.text = "Run MultiscaleAdaptiveStretch";
    this.runMultiscaleAdaptiveStretch_CheckBox.checked = this.engine.runMultiscaleAdaptiveStretch;
    this.runMultiscaleAdaptiveStretch_CheckBox.toolTip = "<p>Enable MultiscaleAdaptiveStretch.</p>";
    this.runMultiscaleAdaptiveStretch_CheckBox.onCheck = function (checked) {
        this.dialog.engine.runMultiscaleAdaptiveStretch = checked;
    };

    this.saveTIFFs_CheckBox = new CheckBox(this);
    this.saveTIFFs_CheckBox.text = "Export TIFFs";
    this.saveTIFFs_CheckBox.checked = this.engine.saveTIFFs;
    this.saveTIFFs_CheckBox.toolTip = "<p>Export TIFF copies of processed result windows.</p>";
    this.saveTIFFs_CheckBox.onCheck = function (checked) {
        this.dialog.engine.saveTIFFs = checked;
    };

    // Layout for process options - vertical column of checkboxes
    this.channelsOptions_GroupBox = new GroupBox(this);
    this.channelsOptions_GroupBox.title = "Channel Options";
    this.channelsOptions_GroupBox.sizer = new VerticalSizer;
    this.channelsOptions_GroupBox.sizer.margin = 6;
    this.channelsOptions_GroupBox.sizer.spacing = 4;
    this.channelsOptions_GroupBox.sizer.add(this.runGraxpertBG_CheckBox);
    this.channelsOptions_GroupBox.sizer.add(this.runBlurXterminatorCorrectOnly_CheckBox);
    this.channelsOptions_GroupBox.sizer.addStretch();  // Push checkboxes to top

    // Layout for process options - vertical column of checkboxes
    this.processOptions_GroupBox = new GroupBox(this);
    this.processOptions_GroupBox.title = "Process Options";
    this.processOptions_GroupBox.sizer = new VerticalSizer;
    this.processOptions_GroupBox.sizer.margin = 6;
    this.processOptions_GroupBox.sizer.spacing = 4;
    this.processOptions_GroupBox.sizer.add(this.runChannelCombination_CheckBox);
    this.processOptions_GroupBox.sizer.add(this.runSPCC_CheckBox);
    this.processOptions_GroupBox.sizer.add(this.runBlurXterminatorFull_CheckBox);
    this.processOptions_GroupBox.sizer.add(this.runNoiseXterminator_CheckBox);
    this.processOptions_GroupBox.sizer.add(this.runStarXterminator_CheckBox);
    this.processOptions_GroupBox.sizer.add(this.runMultiscaleAdaptiveStretch_CheckBox);
    this.processOptions_GroupBox.sizer.add(this.saveTIFFs_CheckBox);
    this.processOptions_GroupBox.sizer.addStretch();  // Push checkboxes to top

    // OK button - closes dialog and returns Dialog.ok status
    this.ok_Button = new PushButton(this);
    this.ok_Button.text = "OK";
    this.ok_Button.icon = this.scaledResource(":/icons/ok.png");
    this.ok_Button.onClick = function () {
        // ---------------------------------------------------------------
        // Dialog.ok() - PJSR Dialog API
        // Closes the dialog with "OK" result
        // After dialog.execute(), you can check if user clicked OK
        // Related: Dialog.cancel() closes with "Cancel" result
        // ---------------------------------------------------------------
        this.dialog.ok();
    };

    // Cancel button - closes dialog and returns Dialog.cancel status
    this.cancel_Button = new PushButton(this);
    this.cancel_Button.text = "Cancel";
    this.cancel_Button.icon = this.scaledResource(":/icons/cancel.png");
    this.cancel_Button.onClick = function () {
        // Dialog.cancel() - Closes dialog, execute() returns false
        this.dialog.cancel();
    };

    // Bottom button bar with OK/Cancel pushed to the right
    this.buttons_Sizer = new HorizontalSizer;
    this.buttons_Sizer.spacing = 6;
    this.buttons_Sizer.addStretch();  // Push buttons to right side
    this.buttons_Sizer.add(this.ok_Button);
    this.buttons_Sizer.add(this.cancel_Button);

    // ---------------------------------------------------------------
    // Dialog.sizer - Property
    // The main layout manager for the dialog
    // Must be assigned a Sizer to arrange all top-level widgets
    // All widgets not added to this sizer (directly or nested) won't appear
    // ---------------------------------------------------------------
    this.sizer = new VerticalSizer;
    this.sizer.margin = 8;   // Outer margin around entire dialog content
    this.sizer.spacing = 8;  // Space between major sections
    this.sizer.add(this.helpLabel);
    this.sizer.addSpacing(4);
    this.sizer.add(this.files_GroupBox);  // GroupBox expands vertically
    this.sizer.addSpacing(4);
    this.sizer.add(this.channelsOptions_GroupBox);  // Channel options section
    this.sizer.addSpacing(4);
    this.sizer.add(this.processOptions_GroupBox);  // Process options section
    this.sizer.addSpacing(4);
    this.sizer.add(this.buttons_Sizer);         // Buttons fixed at bottom

    // ---------------------------------------------------------------
    // Dialog Properties
    // ---------------------------------------------------------------

    // windowTitle: Text shown in the dialog's title bar
    this.windowTitle = this.title;

    // userResizable: Allow user to resize the dialog window
    // Set to false for fixed-size dialogs
    this.userResizable = true;

    // ---------------------------------------------------------------
    // Dialog.adjustToContents() - PJSR Dialog API
    // Resizes the dialog to fit its contents optimally
    // Call after all widgets and sizers are configured
    // Respects minimum sizes set on widgets
    // ---------------------------------------------------------------
    this.adjustToContents();
}

// ---------------------------------------------------------------
// Prototype Inheritance Pattern for PJSR
// This line completes the inheritance from Dialog
// ProcessMastersDialog now has all Dialog methods and properties
// Must come after the constructor function definition
// ---------------------------------------------------------------
ProcessMastersDialog.prototype = new Dialog;

// -----------------------------------------------------------------------
// main()
// Script entry point - called when script is executed
// -----------------------------------------------------------------------
/**
 * Summary: Entry point that initializes the engine/dialog and runs the selected processing workflow.
 * Input: none
 * Output: void
 */
function main() {

    // ---------------------------------------------------------------
    // console.isOpen - PJSR Console API
    // Boolean property indicating if the Process Console is visible
    // Save this to restore the console to its original state on cancel
    // ---------------------------------------------------------------
    let wasConsoleVisible = console.isOpen;

    // ---------------------------------------------------------------
    // console.hide() - PJSR Console API
    // Hides the Process Console window
    // Useful to keep UI clean while dialog is shown
    // Related: console.show() to display the console
    // ---------------------------------------------------------------
    console.show();
    console.noteln("**************************    Welcome to ProcessMasters!   **************************");

    // Create the processing engine instance
    let engine = new ProcessMasters();

    // Create and show the dialog
    let dialog = new ProcessMastersDialog(engine);

    // ---------------------------------------------------------------
    // Dialog.execute() - PJSR Dialog API
    // Shows the dialog modally (blocks until user closes it)
    // Returns: true if user clicked OK, false if cancelled
    // 
    // Note: For non-modal dialogs, use dialog.show() instead
    // ---------------------------------------------------------------
    if (dialog.execute()) {
        // User clicked OK - show console and proceed with processing
        console.show();
        engine.processEachChannelMaster();
        // Leave console visible so user can review the output
    }

    if (wasConsoleVisible) {
        console.show();
    } else {
        console.hide();
    }

    
    console.noteln("**************************    ProcessMasters complete!   **************************");
}

// Start the script
main();
