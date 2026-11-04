package il.atmos.weather;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.EditText;
import android.text.InputType;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class IMSNative {
    private static final String ALIAS = "atmos_ims_aes_key_v1";
    private static final String PREFERENCES = "atmos_ims_credentials";
    private static final String ROOT = "https://api.ims.gov.il/v1/envista/stations";
    private final Activity activity;
    private final WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    IMSNative(Activity activity, WebView web) {
        this.activity=activity;
        this.web=web;
        provisionFromBuild();
    }
    private void provisionFromBuild(){
        if(!token().isEmpty())return;
        try(InputStream in=activity.getAssets().open("ims-bootstrap.txt");
            BufferedReader reader=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8))){
            String configured=reader.readLine();
            if(configured!=null && configured.trim().matches("[a-zA-Z0-9_-]{20,256}"))save(configured.trim());
        }catch(Exception ignored){ /* Without a build secret the history API remains unavailable. */ }
    }


    private String token() {
        try {
            String stored=activity.getSharedPreferences(PREFERENCES,Context.MODE_PRIVATE).getString("encrypted_token",null);
            if(stored==null) return "";
            byte[] payload=Base64.decode(stored,Base64.NO_WRAP);
            if(payload.length<=28) return "";
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            SecretKey key=(SecretKey)store.getKey(ALIAS,null);
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,payload,0,12));
            return new String(cipher.doFinal(payload,12,payload.length-12),StandardCharsets.UTF_8);
        } catch(Exception e) { return ""; }
    }

    private boolean save(String input) {
        if(input==null || input.trim().length()<8) return false;
        try {
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
            if(!store.containsAlias(ALIAS)) {
                KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build());
                generator.generateKey();
            }
            SecretKey key=(SecretKey)store.getKey(ALIAS,null);
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);
            byte[] iv=cipher.getIV(), encrypted=cipher.doFinal(input.trim().getBytes(StandardCharsets.UTF_8));
            byte[] result=new byte[iv.length+encrypted.length];
            System.arraycopy(iv,0,result,0,iv.length);
            System.arraycopy(encrypted,0,result,iv.length,encrypted.length);
            return activity.getSharedPreferences(PREFERENCES,Context.MODE_PRIVATE)
                .edit().putString("encrypted_token",Base64.encodeToString(result,Base64.NO_WRAP)).commit();
        } catch(Exception e) { return false; }
    }

    @JavascriptInterface public boolean isConfigured() { return !token().isEmpty(); }

    @JavascriptInterface public void configure() {
        ui.post(()->{
            EditText input=new EditText(activity);
            input.setSingleLine(true);
            input.setHint("IMS API token");
            input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
            FrameLayout container=new FrameLayout(activity);
            int margin=(int)(22*activity.getResources().getDisplayMetrics().density);
            FrameLayout.LayoutParams layout=new FrameLayout.LayoutParams(-1,-2);
            layout.setMargins(margin,0,margin,0);container.addView(input,layout);
            new AlertDialog.Builder(activity)
                .setTitle("חיבור לשירות המטאורולוגי")
                .setMessage("הזנת טוקן חד־פעמית. הוא יישמר מוצפן במכשיר ולא יופיע בקוד האפליקציה.")
                .setView(container)
                .setNegativeButton("ביטול",null)
                .setPositiveButton("שמור",(dialog,which)->{
                    boolean success=save(input.getText().toString());
                    ui.post(()->web.evaluateJavascript("window.imsConfigured("+success+")",null));
                }).show();
        });
    }

    private void notifyJs(String id,String payload,String failure) {
        ui.post(()->{
            String script="window.imsResponse("+JSONObject.quote(id)+","+
                (payload==null?"null":JSONObject.quote(payload))+","+
                (failure==null?"null":JSONObject.quote(failure))+");";
            web.evaluateJavascript(script,null);
        });
    }

    @JavascriptInterface public void request(String path,String id) {
        if(id==null||!id.matches("[a-zA-Z0-9_-]{1,40}"))return;
        // Prevent arbitrary URLs or headers supplied by web content.
        if(path==null||!(path.equals("")||path.matches("/[0-9]{1,5}")||path.matches("/[0-9]{1,5}/data/earliest")||path.matches("/[0-9]{1,5}/data/latest")||
           path.matches("/[0-9]{1,5}/data\\?from=[0-9]{4}/[0-9]{2}/[0-9]{2}&to=[0-9]{4}/[0-9]{2}/[0-9]{2}"))) {
            notifyJs(id,null,"כתובת בקשה לא חוקית");return;
        }
        final String auth=token();
        if(auth.isEmpty()){notifyJs(id,null,"יש להגדיר טוקן פעם אחת");return;}
        io.execute(()->{
            HttpURLConnection conn=null;
            try {
                conn=(HttpURLConnection)new URL(ROOT+path).openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(18000);conn.setReadTimeout(30000);
                conn.setRequestProperty("Authorization","ApiToken "+auth);
                conn.setRequestProperty("Accept","application/json");
                int status=conn.getResponseCode();
                if(status==204){
                    // 204 is a successful HTTP response with no body, not a parse failure.
                    // Tell the UI which endpoint returned an empty response.
                    notifyJs(id,"{\"data\":[],\"_httpStatus\":204}",null);
                    return;
                }
                InputStream input=status>=400?conn.getErrorStream():conn.getInputStream();
                if(input==null) throw new Exception("HTTP "+status);
                ByteArrayOutputStream buffer=new ByteArrayOutputStream();
                byte[] chunk=new byte[8192];int n;
                while((n=input.read(chunk))!=-1) {
                    buffer.write(chunk,0,n);
                    if(buffer.size()>12*1024*1024)throw new Exception("התגובה גדולה מדי; צמצם את טווח התאריכים");
                }
                input.close();
                if(status!=200)throw new Exception("שירות השמ״ט החזיר HTTP "+status);
                String raw=buffer.toString("UTF-8");
                notifyJs(id,raw,null);
            } catch(Exception e) { notifyJs(id,null,e.getMessage()); }
            finally {if(conn!=null)conn.disconnect();}
        });
    }

    void shutdown(){io.shutdownNow();}
}
