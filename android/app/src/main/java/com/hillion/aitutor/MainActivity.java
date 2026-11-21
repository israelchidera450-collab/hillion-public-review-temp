package com.hillion.aitutor;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HillionSpeechRecognitionPlugin.class);
        registerPlugin(HillionModelManagerPlugin.class);
        registerPlugin(HillionInferencePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
