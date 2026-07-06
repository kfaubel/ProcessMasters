# ProcessMasters

Simple PixInsight script for WBPP post processing.

![PixInsight script screenshot](screenshot.png)

## What the script does

`ProcessMasters.js` automates early post-integration processing for WBPP master files.
It is designed to take channel masters (L, R, G, B, H, S, O), clean up workspace artifacts,
run common AI-assisted correction steps, and produce combined masters for downstream processing.

### Running WBPP
Run WBPP as normal.  If you drissle x2 and enable auto-crop you will end up with lots of files but the last ones created for each channel will look something like this:

```
masterLight_BIN-1_6248x4176_EXPOSURE-30.00s_FILTER-R_mono_drizzle_2x_autocrop.xisf
masterLight_BIN-1_6248x4176_EXPOSURE-30.00s_FILTER-G_mono_drizzle_2x_autocrop.xisf
masterLight_BIN-1_6248x4176_EXPOSURE-30.00s_FILTER-B_mono_drizzle_2x_autocrop.xisf
```

These filenames are not very useful for processing beyond the name of the filter.  These files also contain a `crop_mask` window that is not needed for further processing.  

### Running the script
Go to the Script menu in PixInsight and select `Treehouse Astro -> ProcessMasters`.  A dialog will open that allows you to select the master files you want to process.  The script will detect the filter type from the file name and save  files to `L.xisf`, `R.xisf`, etc.  It will also close any `crop_mask` windows that are open.

If you captured narrowband data for a nebula and you captured RGB for stars you would select all 6 channels (R, G, B, H, S, O).

If you captured a galaxy with L, R, G, B you would select those 4 channels.

There are dialog options to apply optional per-channel processing such as GraXpert background extraction and BlurXTerminator (correct-only).  
- If the script detects that you have S, H & O channels it will combine those into an SHO image.  
- If you have R, G & B channels it will combine those into an RGB image.  
- If you have Luminance it will process that channel separately.

So given S, H, O, R, G, B as input, you will get both an SHO and an RGB image.

After combination it will
- Run SPCC (RGB only)
- Run BXT, NXT, and SXT
- It will then automatically do a basic stretch on starless images using MultiscaleAdaptiveStretch
- It will then automatically do a mild MaskedStretch on the stars image
- Finally it exports the starless and stars images as 16bit TIFF files for processing in non-destructive imaging application like Affinity, Photoshop or GIMP.

## How it works
- The script separates UI and processing logic.
- The processing engine uses PixInsight processes.  Many of the processes are easily updated by changing the parameters in functions like this:
```javascript
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
```
Note: if you open a process from the Process menu, you can click the `Instance Source Code` button to see the key code to run that process.  This can be used to update many of the processing functions in this script.
- The UI uses the Qt framework build into PixInsight.  Its very basic right now but it is functional.  It will be updated over time to improve usability and expose options for more advanced processing.

## Disclaimers
- This script is provided as-is.  It is intended to automate common post-processing steps, but it is not suitable for all datasets or workflows.  
- It is still a work in progress and will get periodic updates.
- It uses the older PJSR framework and needs to be updated to use the new Google V8 JavaScript engine.

## Local Deploy

To deploy this locally, use the localdeploy.bat script. This deploys the script to the PixInsight scripts directory.  The default location is

`C:\Program Files\PixInsight\src\scripts\local\`

Because this location is under Program Files, run from an elevated (Administrator) shell.

To get Pixinsight to recognize the script, you need to run Scripts -> Feature Scripts... and select the `C:\Program Files\PixInsight\src\scripts\local\` directory.  After that, the script will be available in the Script menu.

## Public Deployment
Run release.bat (Major|Minor|Patch)   - Update the version, generate the release.zip file and generate the SHA1 hash for the release.zip file.
Commit the changes to GitHub and push. 

### Install into Pixinsight
- Open Resources -> Updates -> Manage Repositories...
- Click Add and enter `https://raw.githubusercontent.com/kfaubel/ProcessMasters/main/`
- Open Resources -> Updates -> Check for Updates...
- Close PixInsight and let it restart after updates.
- Check Scripts -> Treehouse Astro -> ProcessMasters to open the script dialog

## Requirements

- Windows
- Bash (for example Git Bash)
- PowerShell available on PATH

## License

MIT. See `LICENSE`.
