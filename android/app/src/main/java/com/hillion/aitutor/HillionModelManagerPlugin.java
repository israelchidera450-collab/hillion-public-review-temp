package com.hillion.aitutor;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.os.ParcelFileDescriptor;
import android.os.StatFs;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Locale;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "HillionModelManager")
public class HillionModelManagerPlugin extends Plugin {
    private static final String MODEL_DIR = "models";
    private static final String MODEL_EXTENSION = ".gguf";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final byte[] GGUF_MAGIC = new byte[] { 'G', 'G', 'U', 'F' };

    @PluginMethod
    public void importModel(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            "application/octet-stream", "application/x-gguf", "application/gguf"
        });
        startActivityForResult(call, intent, "handleModelPickerResult");
    }

    @ActivityCallback
    private void handleModelPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            call.reject("Model selection was cancelled.");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("Android did not return a model file.");
            return;
        }
        IO.execute(() -> copyAndValidateModel(call, uri));
    }

    private void copyAndValidateModel(PluginCall call, Uri uri) {
        // Use the same app-specific storage resolution as getModelFile().
        // External app-specific storage is preferred for large GGUF files; internal
        // app storage is the fallback when Android does not expose that volume.
        File appFiles = getContext().getExternalFilesDir(null);
        if (appFiles == null) appFiles = getContext().getFilesDir();
        if (appFiles == null) {
            call.reject("Android could not access HILLION's app-specific storage.");
            return;
        }
        File modelDirectory = new File(appFiles, MODEL_DIR);
        if (!modelDirectory.exists() && !modelDirectory.mkdirs()) {
            call.reject("HILLION could not create its private model folder.");
            return;
        }

        String displayName = queryDisplayName(uri);
        if (displayName == null || !displayName.toLowerCase(Locale.ROOT).endsWith(MODEL_EXTENSION)) {
            call.reject("Please select a GGUF model file (.gguf).");
            return;
        }

        File temporaryFile = new File(modelDirectory, "model-import.tmp");
        File destination = new File(modelDirectory, "hillion-model.gguf");
        File previousFile = new File(modelDirectory, "hillion-model.previous");
        long copied = 0L;
        try (ParcelFileDescriptor descriptor = getContext().getContentResolver().openFileDescriptor(uri, "r")) {
            if (descriptor == null) throw new IllegalStateException("Android could not inspect the selected file.");
            long expectedSize = descriptor.getStatSize();
            if (expectedSize > 0L && new StatFs(modelDirectory.getAbsolutePath()).getAvailableBytes() < expectedSize + (32L * 1024L * 1024L)) {
                throw new IllegalStateException("There is not enough free storage to import this model safely.");
            }
        } catch (java.io.IOException error) {
            call.reject("HILLION could not inspect the selected model file: " + error.getMessage());
            return;
        }
        try (InputStream raw = getContext().getContentResolver().openInputStream(uri)) {
            if (raw == null) throw new IllegalStateException("Android could not open the selected file.");
            try (BufferedInputStream input = new BufferedInputStream(raw);
                 OutputStream output = new BufferedOutputStream(new FileOutputStream(temporaryFile))) {
                byte[] header = new byte[4];
                int headerRead = 0;
                while (headerRead < header.length) {
                    int count = input.read(header, headerRead, header.length - headerRead);
                    if (count < 0) break;
                    headerRead += count;
                }
                if (headerRead != 4 || !matchesMagic(header)) {
                    throw new IllegalArgumentException("The selected file does not have the GGUF file signature.");
                }
                output.write(header);
                copied = 4;
                byte[] buffer = new byte[1024 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    // Providers sometimes report an unknown file size. Recheck free
                    // space during the copy so a large import fails cleanly before
                    // exhausting the app's storage volume.
                    long available = new StatFs(modelDirectory.getAbsolutePath()).getAvailableBytes();
                    long reserveBytes = 32L * 1024L * 1024L;
                    if (available < count + reserveBytes) {
                        throw new IllegalStateException("Not enough free storage remains to finish importing this model safely.");
                    }
                    output.write(buffer, 0, count);
                    copied += count;
                }
                output.flush();
            }
            if (copied < 1024 * 1024) {
                throw new IllegalArgumentException("The selected GGUF file is unexpectedly small.");
            }
            if (previousFile.exists()) previousFile.delete();
            if (destination.exists() && !destination.renameTo(previousFile)) {
                throw new IllegalStateException("Could not safely stage the previous model for replacement.");
            }
            if (!temporaryFile.renameTo(destination)) {
                if (previousFile.exists()) previousFile.renameTo(destination);
                throw new IllegalStateException("Could not finish saving the model in HILLION storage.");
            }
            if (previousFile.exists()) previousFile.delete();
            JSObject response = new JSObject();
            response.put("ready", true);
            response.put("name", displayName);
            response.put("storedName", destination.getName());
            response.put("sizeBytes", copied);
            response.put("sizeMB", Math.round((copied / 1048576.0) * 10.0) / 10.0);
            response.put("path", destination.getAbsolutePath());
            call.resolve(response);
        } catch (Exception error) {
            // Keep the previous model intact if import/validation fails.
            // The temporary file is never exposed as the active model.
            if (temporaryFile.exists()) temporaryFile.delete();
            call.reject("Model import failed: " + error.getMessage());
        }
    }

    @PluginMethod
    public void getModelStatus(PluginCall call) {
        File model = getModelFile();
        JSObject response = new JSObject();
        response.put("ready", model.isFile() && model.length() > 0L);
        response.put("storedName", model.getName());
        response.put("sizeBytes", model.isFile() ? model.length() : 0L);
        response.put("sizeMB", model.isFile() ? Math.round((model.length() / 1048576.0) * 10.0) / 10.0 : 0.0);
        response.put("path", model.isFile() ? model.getAbsolutePath() : "");
        call.resolve(response);
    }

    @PluginMethod
    public void removeModel(PluginCall call) {
        File model = getModelFile();
        File previous = new File(model.getParentFile(), "hillion-model.previous");
        if (previous.exists()) previous.delete();
        if (model.exists() && !model.delete()) {
            call.reject("HILLION could not remove the stored model.");
            return;
        }
        JSObject response = new JSObject();
        response.put("ready", false);
        call.resolve(response);
    }

    private File getModelFile() {
        File appFiles = getContext().getExternalFilesDir(null);
        if (appFiles == null) appFiles = getContext().getFilesDir();
        return new File(new File(appFiles, MODEL_DIR), "hillion-model.gguf");
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) { }
        return null;
    }

    private boolean matchesMagic(byte[] value) {
        if (value == null || value.length < 4) return false;
        for (int i = 0; i < 4; i++) if (value[i] != GGUF_MAGIC[i]) return false;
        return true;
    }
}
