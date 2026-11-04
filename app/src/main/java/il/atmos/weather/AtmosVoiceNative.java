package il.atmos.weather;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Android speech UI: device speech-recognition activity + Hebrew TTS.
 * No microphone audio is sent to the Atmos WebView or GitHub.
 * The speech-recognition provider used by Android may process audio remotely.
 */
public class AtmosVoiceNative implements TextToSpeech.OnInitListener {
    static final int SPEECH_REQUEST=2417;
    private final Activity activity;
    private final WebView web;
    private final Handler main=new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private volatile boolean ttsReady=false;
    private volatile boolean hebrewSupported=false;
    private final Locale hebrew=new Locale("he","IL");

    AtmosVoiceNative(Activity activity,WebView web){
        this.activity=activity;
        this.web=web;
        main.post(()->{
            try {tts=new TextToSpeech(activity,this);}
            catch(Exception e){send("voiceError","לא ניתן להפעיל כרגע הקראה קולית.");}
        });
    }

    private void send(String name,String value){
        main.post(()->web.evaluateJavascript("window."+name+"("+JSONObject.quote(value)+");",null));
    }
    @Override public void onInit(int status){
        ttsReady=status==TextToSpeech.SUCCESS && tts!=null;
        if(ttsReady){
            int available=tts.setLanguage(hebrew);
            hebrewSupported=available!=TextToSpeech.LANG_MISSING_DATA &&
                available!=TextToSpeech.LANG_NOT_SUPPORTED;
            tts.setSpeechRate(0.94f);
        }
        send("atmosVoiceReady",hebrewSupported?"ready":"unavailable");
    }
    @JavascriptInterface public void listen(){
        main.post(()->{
            Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"he-IL");
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE,"he-IL");
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT,"מה תרצה לשאול את אטמוס?");
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1);
            try { activity.startActivityForResult(intent,SPEECH_REQUEST); }
            catch(ActivityNotFoundException error){send("atmosVoiceError","אין בטלפון שירות זיהוי דיבור זמין.");}
            catch(Exception error){send("atmosVoiceError","לא הצלחתי לפתוח את המיקרופון.");}
        });
    }
    @JavascriptInterface public void speak(String text){
        if(text==null)return;
        final String safe=text.replaceAll("[*#_\\x60]+","")
            .replaceAll("https?://\\S+","קישור")
            .trim();
        if(safe.length()==0)return;
        main.post(()->{
            if(!ttsReady||!hebrewSupported||tts==null){
                send("atmosVoiceError","הקראה בעברית לא זמינה במכשיר. אפשר להתקין קול עברי בהגדרות הקראת טקסט.");
                return;
            }
            tts.stop();
            tts.speak(safe.substring(0,Math.min(safe.length(),2500)),
                TextToSpeech.QUEUE_FLUSH,null,"atmos-answer");
        });
    }
    @JavascriptInterface public void stop(){main.post(()->{if(tts!=null)tts.stop();});}
    void onRecognitionResult(int resultCode,Intent data){
        if(resultCode!=Activity.RESULT_OK||data==null){
            send("atmosVoiceCancelled","cancelled");
            return;
        }
        ArrayList<String> matches=data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if(matches==null||matches.isEmpty()||matches.get(0).trim().isEmpty()){
            send("atmosVoiceError","לא שמעתי את השאלה. אפשר לנסות שוב?");
            return;
        }
        send("atmosVoiceRecognized",matches.get(0).trim());
    }
    void shutdown(){main.post(()->{if(tts!=null){tts.stop();tts.shutdown();tts=null;}});}
}
