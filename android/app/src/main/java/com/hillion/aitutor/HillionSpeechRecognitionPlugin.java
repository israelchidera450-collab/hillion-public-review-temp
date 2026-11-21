package com.hillion.aitutor;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

@CapacitorPlugin(
    name = "HillionSpeechRecognition",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class HillionSpeechRecognitionPlugin extends Plugin implements RecognitionListener {
    private SpeechRecognizer recognizer;

    @PluginMethod
    public void startListening(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "startListeningPermissionCallback");
            return;
        }
        startRecognizer(call);
    }

    @PermissionCallback
    private void startListeningPermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission is required for voice questions.");
            return;
        }
        startRecognizer(call);
    }

    private void startRecognizer(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                    call.reject("Speech recognition is not available on this Android device.");
                    return;
                }
                stopRecognizer();
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(this);

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB");
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-GB");
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                recognizer.startListening(intent);
                call.resolve();
            } catch (Exception error) {
                stopRecognizer();
                call.reject("Could not start Android speech recognition: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stopRecognizer();
            call.resolve();
        });
    }

    private void stopRecognizer() {
        if (recognizer != null) {
            try { recognizer.stopListening(); } catch (Exception ignored) { }
            try { recognizer.cancel(); } catch (Exception ignored) { }
            releaseRecognizer();
        }
    }

    private void releaseRecognizer() {
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Exception ignored) { }
            recognizer = null;
        }
    }

    private void publishTranscript(Bundle results, boolean isFinal) {
        if (results == null) return;
        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return;
        JSObject payload = new JSObject();
        payload.put("transcript", matches.get(0));
        payload.put("isFinal", isFinal);
        notifyListeners("speechResult", payload);
    }

    @Override public void onReadyForSpeech(Bundle params) { }
    @Override public void onBeginningOfSpeech() { }
    @Override public void onRmsChanged(float rmsdB) { }
    @Override public void onBufferReceived(byte[] buffer) { }
    @Override public void onEndOfSpeech() { }

    @Override
    public void onError(int error) {
        JSObject payload = new JSObject();
        payload.put("error", error);
        notifyListeners("speechError", payload);
        releaseRecognizer();
    }

    @Override public void onResults(Bundle results) { publishTranscript(results, true); releaseRecognizer(); }
    @Override public void onPartialResults(Bundle partialResults) { publishTranscript(partialResults, false); }
    @Override public void onEvent(int eventType, Bundle params) { }

    @Override
    protected void handleOnDestroy() {
        stopRecognizer();
        super.handleOnDestroy();
    }
}
