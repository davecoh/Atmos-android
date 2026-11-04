package il.atmos.weather;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONArray;
import okhttp3.OkHttpClient;
import okhttp3.Dns;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.MediaType;
import okhttp3.Response;
import okhttp3.ResponseBody;
import java.net.UnknownHostException;
import org.json.JSONObject;
import java.io.*;
import java.math.BigInteger;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.RSAPublicKeySpec;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** OpenAI public OSS SIWC client; OAuth+PKCE with loopback and ID token verification. */
public final class ChatGPTNative {
    private static final String AUTH="https://auth.openai.com/api/accounts/authorize";
    private static final String TOKEN="https://auth.openai.com/api/accounts/oauth/token";
    private static final String RESOURCE="https://api.openai.com/v1";
    private static final String PREF="atmos_siwc";
    private static final String KEY="atmos_chatgpt_key_v1";
    private static final int LIMIT=2_000_000;
    private final Activity activity;
    private final WebView web;
    private final Handler ui=new Handler(Looper.getMainLooper());
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private volatile boolean loginBusy=false;
    private volatile ServerSocket callbackServer;
    private volatile String lastState="idle";
    ChatGPTNative(Activity a,WebView w){activity=a;web=w;}
    private String random(int bytes) {
        byte[] b=new byte[bytes];new SecureRandom().nextBytes(b);
        return Base64.encodeToString(b,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
    }
    private String hostId(){
        android.content.SharedPreferences p=activity.getSharedPreferences(PREF,Context.MODE_PRIVATE);
        String id=p.getString("host_id","");
        if(id.isEmpty()){id="urn:uuid:"+UUID.randomUUID().toString();p.edit().putString("host_id",id).apply();}
        return id;
    }
    private static String enc(String value) throws Exception{
        return java.net.URLEncoder.encode(value,"UTF-8");
    }
    private void call(String function, String... values){
        StringBuilder js=new StringBuilder("window.").append(function).append("(");
        for(int i=0;i<values.length;i++){if(i>0)js.append(",");js.append(JSONObject.quote(values[i]));}
        js.append(");");
        ui.post(()->web.evaluateJavascript(js.toString(),null));
    }
    private byte[] encrypt(String value)throws Exception{
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias(KEY)){
            KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(KEY,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build());gen.generateKey();
        }
        SecretKey key=(SecretKey)store.getKey(KEY,null);
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key);
        byte[] iv=c.getIV(),payload=c.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] out=new byte[iv.length+payload.length];System.arraycopy(iv,0,out,0,iv.length);System.arraycopy(payload,0,out,iv.length,payload.length);
        return out;
    }
    private String decrypt(byte[] bytes)throws Exception{
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        SecretKey key=(SecretKey)store.getKey(KEY,null);if(key==null)throw new Exception("Missing Android key");
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,bytes,0,12));
        return new String(c.doFinal(bytes,12,bytes.length-12),StandardCharsets.UTF_8);
    }
    private JSONObject profile(){
        try {
            String saved=activity.getSharedPreferences(PREF,Context.MODE_PRIVATE).getString("profile",null);
            return saved==null?null:new JSONObject(decrypt(Base64.decode(saved,Base64.NO_WRAP)));
        }catch(Exception e){return null;}
    }
    private void save(JSONObject p)throws Exception{
        String v=Base64.encodeToString(encrypt(p.toString()),Base64.NO_WRAP);
        if(!activity.getSharedPreferences(PREF,Context.MODE_PRIVATE).edit().putString("profile",v).commit())throw new Exception("Credentials not saved");
    }
    private void record(String state,String message){
        lastState=state;
        activity.getSharedPreferences(PREF,Context.MODE_PRIVATE).edit()
            .putString("auth_state",state).putString("auth_message",message).apply();
        call("atmosLoginResult",state,message);
    }
    @JavascriptInterface public String diagnostic(){
        android.content.SharedPreferences p=activity.getSharedPreferences(PREF,Context.MODE_PRIVATE);
        JSONObject info=new JSONObject();
        try {
            boolean ok=connected();
            info.put("connected",ok);
            info.put("state",ok?"success":p.getString("auth_state","idle"));
            info.put("message",ok?"ההרשאות נשמרו במכשיר":p.getString("auth_message","לא בוצעה התחברות"));
        }catch(Exception ignored){}
        return info.toString();
    }
    @JavascriptInterface public boolean connected(){
        JSONObject p=profile();return p!=null&&p.has("refresh_token")&&p.optString("scopes").contains("chatgpt.tokens.use.direct");
    }
    @JavascriptInterface public void signIn(){
        if(loginBusy)return;loginBusy=true;
        record("progress","מתחיל תהליך התחברות…");
        io.execute(()->{
            try {signInInternal();}
            catch(Exception e){record("error",e.getMessage()==null?"Unknown OAuth error":e.getMessage());}
            finally {loginBusy=false;closeServer();}
        });
    }
    private void closeServer(){try{if(callbackServer!=null)callbackServer.close();}catch(Exception ignored){}callbackServer=null;}
    private void signInInternal()throws Exception{
        JSONObject old=profile();
        String client=old==null?activity.getSharedPreferences(PREF,Context.MODE_PRIVATE).getString("registered_client","dynamic_agent_client"):old.optString("client_id");
        if(client.isEmpty())client="dynamic_agent_client";
        String state=random(24),nonce=random(24),verifier=random(32);
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
        String challenge=Base64.encodeToString(hash,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
        ServerSocket server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"));callbackServer=server;
        server.setSoTimeout(180000);
        String redirect="http://127.0.0.1:"+server.getLocalPort()+"/auth/callback";
        Uri.Builder u=Uri.parse(AUTH).buildUpon()
            .appendQueryParameter("client_id",client)
            .appendQueryParameter("ext_agent_host_id",hostId())
            .appendQueryParameter("redirect_uri",redirect)
            .appendQueryParameter("response_type","code")
            .appendQueryParameter("scope","openid profile email offline_access resource.invoke chatgpt.tokens.use.direct")
            .appendQueryParameter("resource",RESOURCE)
            .appendQueryParameter("state",state).appendQueryParameter("nonce",nonce)
            .appendQueryParameter("code_challenge_method","S256")
            .appendQueryParameter("code_challenge",challenge);
        if("dynamic_agent_client".equals(client))u.appendQueryParameter("agent_name_hint","Atmos Weather");
        else {String id=old.optString("id_token");if(!id.isEmpty())u.appendQueryParameter("id_token_hint",id);}
        record("progress","ממתין לאישור בדפדפן ChatGPT…");
        ui.post(()->activity.startActivity(new Intent(Intent.ACTION_VIEW,u.build()).addCategory(Intent.CATEGORY_BROWSABLE)));
        Socket sock=server.accept();sock.setSoTimeout(15000);
        BufferedReader reader=new BufferedReader(new InputStreamReader(sock.getInputStream(),StandardCharsets.UTF_8));
        String first=reader.readLine();if(first==null||!first.startsWith("GET /auth/callback?"))throw new Exception("Invalid OAuth callback");
        String headerLine;while((headerLine=reader.readLine())!=null&&!headerLine.isEmpty()){}
        String path=first.split(" ")[1];
        Uri query=Uri.parse("http://127.0.0.1"+path);
        String returned=query.getQueryParameter("state");
        if(!state.equals(returned))throw new Exception("OAuth state mismatch");
        String error=query.getQueryParameter("error");
        String code=query.getQueryParameter("code");
        String issued=query.getQueryParameter("client_id");
        if("dynamic_agent_client".equals(client)){
            if(issued==null||!issued.startsWith("oaiapp_"))throw new Exception("Missing issued client ID in OAuth callback");
            client=issued;
            activity.getSharedPreferences(PREF,Context.MODE_PRIVATE).edit().putString("registered_client",client).commit();
        } else if(issued!=null&&!issued.equals(client))throw new Exception("OAuth client mismatch");
        String page=error!=null?"Authorization cancelled":"Authorization callback received. The app is verifying your sign-in. Return to Atmos.";
        byte[] body=("<html><body><h2>"+page+"</h2><p>You may close this page.</p></body></html>").getBytes(StandardCharsets.UTF_8);
        OutputStream out=sock.getOutputStream();
        out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        out.write(body);out.flush();sock.close();closeServer();
        if(error!=null)throw new Exception("Sign-in cancelled: "+error);
        if(code==null||code.isEmpty())throw new Exception("Missing authorization code");
        record("progress","קוד ההרשאה התקבל. מחליף אותו בטוקנים…");
        String data="grant_type=authorization_code&client_id="+enc(client)+"&code="+enc(code)+"&code_verifier="+enc(verifier)+"&redirect_uri="+enc(redirect)+"&resource="+enc(RESOURCE);
        JSONObject token=postForm(TOKEN,data);
        record("progress","טוקנים התקבלו. מאמת חתימה והרשאות…");
        JSONObject claims=verifyIdToken(token.getString("id_token"),client,nonce);
        String scopes=token.optString("scope");
        if(!Arrays.asList(scopes.split(" ")).contains("chatgpt.tokens.use.direct"))throw new Exception("ChatGPT plan usage permission not granted");
        if(old!=null&&!old.optString("subject").equals(claims.getString("sub")))throw new Exception("Account mismatch");
        JSONObject saved=new JSONObject();
        saved.put("client_id",client);saved.put("subject",claims.getString("sub"));saved.put("email",claims.optString("email"));
        saved.put("id_token",token.getString("id_token"));saved.put("access_token",token.getString("access_token"));
        saved.put("refresh_token",token.getString("refresh_token"));saved.put("scopes",scopes);
        saved.put("expires_at",System.currentTimeMillis()+1000L*token.optLong("expires_in",3600));
        save(saved);
        record("success",claims.optString("email","ChatGPT account"));
    }
    private JSONObject verifyIdToken(String jwt,String client,String nonce)throws Exception{
        String[] part=jwt.split("\\.");if(part.length!=3)throw new Exception("Malformed ID token");
        JSONObject header=new JSONObject(new String(Base64.decode(part[0],Base64.URL_SAFE),StandardCharsets.UTF_8));
        JSONObject body=new JSONObject(new String(Base64.decode(part[1],Base64.URL_SAFE),StandardCharsets.UTF_8));
        if(!"RS256".equals(header.optString("alg")))throw new Exception("Unexpected ID token algorithm");
        if(!"https://auth.openai.com".equals(body.optString("iss")))throw new Exception("Invalid issuer");
        Object aud=body.get("aud");boolean audience=aud instanceof String?client.equals(aud):aud instanceof JSONArray&&((JSONArray)aud).toString().contains(JSONObject.quote(client));
        if(!audience||!nonce.equals(body.optString("nonce"))||body.optLong("exp")*1000L<=System.currentTimeMillis())throw new Exception("Invalid ID token claims");
        JSONObject keys=getJson("https://auth.openai.com/.well-known/jwks.json",null);
        JSONArray arr=keys.getJSONArray("keys");boolean valid=false;
        for(int i=0;i<arr.length();i++){
            JSONObject key=arr.getJSONObject(i);if(!header.optString("kid").equals(key.optString("kid"))||!"RSA".equals(key.optString("kty")))continue;
            byte[] n=Base64.decode(key.getString("n"),Base64.URL_SAFE),e=Base64.decode(key.getString("e"),Base64.URL_SAFE);
            java.security.spec.RSAPublicKeySpec spec=new RSAPublicKeySpec(new BigInteger(1,n),new BigInteger(1,e));
            PublicKey pub=KeyFactory.getInstance("RSA").generatePublic(spec);
            Signature sig=Signature.getInstance("SHA256withRSA");sig.initVerify(pub);sig.update((part[0]+"."+part[1]).getBytes(StandardCharsets.US_ASCII));
            valid=sig.verify(Base64.decode(part[2],Base64.URL_SAFE));break;
        }
        if(!valid)throw new Exception("ID token signature validation failed");
        return body;
    }
    private String read(InputStream in)throws Exception{
        ByteArrayOutputStream b=new ByteArrayOutputStream();byte[] buf=new byte[8192];int k;
        while((k=in.read(buf))>=0){b.write(buf,0,k);if(b.size()>LIMIT)throw new Exception("Response too large");}
        return b.toString("UTF-8");
    }
    /**
     * Keep the requested HTTPS hostname intact (TLS SNI and certificate verification).
     * If Android system DNS fails for an OpenAI hostname, retrieve its DNS A records
     * over HTTPS from a public DNS provider. Only IP addresses, never credentials,
     * are returned by this fallback.
     */
    private static final class OpenAIDns implements Dns {
        private final Dns system=Dns.SYSTEM;
        private static InetAddress addr(String hostname,int a,int b,int c,int d) throws UnknownHostException {
            return InetAddress.getByAddress(hostname,new byte[]{(byte)a,(byte)b,(byte)c,(byte)d});
        }
        private static List<InetAddress> parseAnswers(String hostname,JSONObject json) throws Exception {
            if(json.optInt("Status",-1)!=0)throw new Exception("DoH returned non-success status");
            JSONArray answers=json.optJSONArray("Answer");
            List<InetAddress> result=new ArrayList<>();
            if(answers!=null)for(int i=0;i<answers.length();i++){
                JSONObject item=answers.optJSONObject(i);
                if(item==null||item.optInt("type")!=1)continue;
                String value=item.optString("data");
                if(!value.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}"))continue;
                String[] parts=value.split("\\.");
                byte[] bytes=new byte[4];boolean valid=true;
                for(int j=0;j<4;j++){
                    int n=Integer.parseInt(parts[j]);
                    if(n>255){valid=false;break;}
                    bytes[j]=(byte)n;
                }
                if(valid)result.add(InetAddress.getByAddress(hostname,bytes));
            }
            return result;
        }
        private List<InetAddress> resolveHttps(String hostname,String provider) throws Exception {
            String serviceHost="google".equals(provider)?"dns.google":"cloudflare-dns.com";
            String url="google".equals(provider)
                ?"https://dns.google/resolve?name="+hostname+"&type=A"
                :"https://cloudflare-dns.com/dns-query?name="+hostname+"&type=A";
            // Bootstrap the encrypted resolver with known public IPs, bypassing Android
            // DNS only for the resolver itself. TLS retains the hostname and is verified.
            Dns bootstrap=h->{
                if("dns.google".equals(h))return Arrays.asList(
                    addr(h,8,8,8,8),addr(h,8,8,4,4));
                if("cloudflare-dns.com".equals(h))return Arrays.asList(
                    addr(h,1,1,1,1),addr(h,1,0,0,1));
                return Dns.SYSTEM.lookup(h);
            };
            OkHttpClient doh=new OkHttpClient.Builder().dns(bootstrap)
                .connectTimeout(7,TimeUnit.SECONDS)
                .readTimeout(7,TimeUnit.SECONDS)
                .build();
            Request request=new Request.Builder().url(url)
                .header("Accept","application/dns-json")
                .get().build();
            try(Response response=doh.newCall(request).execute()){
                if(!response.isSuccessful()||response.body()==null)throw new Exception("DoH HTTP "+response.code());
                JSONObject json=new JSONObject(response.body().string());
                List<InetAddress> addresses=parseAnswers(hostname,json);
                if(addresses.isEmpty())throw new Exception("No A records found");
                return addresses;
            }
        }
        @Override public List<InetAddress> lookup(String host) throws UnknownHostException {
            try {return system.lookup(host);}
            catch(UnknownHostException original){
                if(!"auth.openai.com".equals(host)&&!"api.openai.com".equals(host))throw original;
                List<String> failures=new ArrayList<>();
                for(String provider:new String[]{"google","cloudflare"}){
                    try{return resolveHttps(host,provider);}
                    catch(Exception failure){failures.add(provider+":"+failure.getClass().getSimpleName());}
                }
                throw new UnknownHostException("DNS failed for "+host+
                    "; encrypted resolver bootstrap also failed ("+String.join(", ",failures)+")");
            }
        }
    }
    private final OkHttpClient http=new OkHttpClient.Builder()
        .dns(new OpenAIDns())
        .connectTimeout(20,TimeUnit.SECONDS)
        .readTimeout(120,TimeUnit.SECONDS)
        .build();
    private JSONObject request(String uri,String method,String contentType,String data,String bearer)throws Exception{
        Request.Builder builder=new Request.Builder().url(uri).header("Accept","application/json");
        if(bearer!=null)builder.header("Authorization","Bearer "+bearer);
        if(data!=null){
            builder.post(RequestBody.create(data,MediaType.parse(contentType)));
        }else builder.get();
        try(Response response=http.newCall(builder.build()).execute()){
            ResponseBody body=response.body();
            String raw=body==null?"":body.string();
            if(raw.length()>LIMIT)throw new Exception("Response too large");
            if(!response.isSuccessful())throw new Exception("OpenAI HTTP "+response.code()+": "+raw.substring(0,Math.min(raw.length(),300)));
            return new JSONObject(raw);
        }
    }

    private JSONObject postForm(String url,String data)throws Exception{return request(url,"POST","application/x-www-form-urlencoded",data,null);}
    private JSONObject getJson(String uri,String bearer)throws Exception{return request(uri,"GET",null,null,bearer);}
    private String accessToken()throws Exception{
        JSONObject p=profile();if(p==null)throw new Exception("Not signed in");
        if(System.currentTimeMillis()+120000L<p.optLong("expires_at"))return p.getString("access_token");
        JSONObject refreshed=postForm(TOKEN,"grant_type=refresh_token&client_id="+enc(p.getString("client_id"))+
                "&refresh_token="+enc(p.getString("refresh_token"))+"&resource="+enc(RESOURCE));
        p.put("access_token",refreshed.getString("access_token"));
        p.put("refresh_token",refreshed.optString("refresh_token",p.getString("refresh_token")));
        p.put("scopes",refreshed.optString("scope",p.optString("scopes")));
        p.put("expires_at",System.currentTimeMillis()+1000L*refreshed.optLong("expires_in",3600));
        save(p);return p.getString("access_token");
    }
    @JavascriptInterface public void listModels(String id){
        io.execute(()->{try{JSONObject data=getJson(RESOURCE+"/models",accessToken());call("atmosModelsResult",id,data.toString(),"");}
        catch(Exception e){call("atmosModelsResult",id,"",e.getMessage());}});
    }
    @JavascriptInterface public void ask(String prompt,String model,String id){
        if(prompt==null||prompt.length()>16000||model==null||!model.matches("[a-zA-Z0-9._-]{1,100}"))return;
        io.execute(()->{try{
            JSONObject req=new JSONObject();req.put("model",model);req.put("store",false);req.put("stream",true);
            req.put("input",new JSONArray().put(new JSONObject().put("role","user").put("content",prompt)));
            String answer=streamResponse(req,accessToken());call("atmosAIResult",id,answer,"");
        }catch(Exception e){call("atmosAIResult",id,"",e.getMessage());}});
    }
    @JavascriptInterface public void analyzeWeatherMap(String prompt,String pngDataUrl,String model,String id){
        if(prompt==null||prompt.length()>6500||pngDataUrl==null||pngDataUrl.length()>750000
          ||!pngDataUrl.startsWith("data:image/png;base64,")
          ||model==null||!model.matches("[a-zA-Z0-9._-]{1,100}")
          ||id==null||!id.matches("[a-zA-Z0-9_-]{1,40}"))return;
        io.execute(()->{
            try{
                JSONObject req=new JSONObject();
                req.put("model",model);req.put("store",false);req.put("stream",true);
                JSONArray content=new JSONArray();
                content.put(new JSONObject().put("type","input_text").put("text",prompt));
                content.put(new JSONObject().put("type","input_image")
                    .put("image_url",pngDataUrl).put("detail","high"));
                req.put("input",new JSONArray().put(
                    new JSONObject().put("role","user").put("content",content)));
                String result=streamResponse(req,accessToken());
                call("atmosAIResult",id,result,"");
            }catch(Exception error){
                call("atmosAIResult",id,"",error.getMessage());
            }
        });
    }
    private String streamResponse(JSONObject req,String bearer)throws Exception{
        Request request=new Request.Builder().url(RESOURCE+"/responses")
            .header("Authorization","Bearer "+bearer)
            .header("Accept","text/event-stream")
            .post(RequestBody.create(req.toString(),MediaType.parse("application/json")))
            .build();
        try(Response response=http.newCall(request).execute()){
            ResponseBody body=response.body();
            if(!response.isSuccessful())throw new Exception("Responses HTTP "+response.code()+": "+(body==null?"":body.string()));
            if(body==null)throw new Exception("Empty Responses body");
            BufferedReader reader=new BufferedReader(new InputStreamReader(body.byteStream(),StandardCharsets.UTF_8));
            String line;StringBuilder result=new StringBuilder();boolean complete=false;
            while((line=reader.readLine())!=null){
                if(!line.startsWith("data: "))continue;
                String chunk=line.substring(6);
                if("[DONE]".equals(chunk))break;
                JSONObject ev;try{ev=new JSONObject(chunk);}catch(Exception ignored){continue;}
                String type=ev.optString("type");
                if("response.output_text.delta".equals(type))result.append(ev.optString("delta"));
                if("response.failed".equals(type))throw new Exception("Responses failed: "+ev.toString().substring(0,Math.min(ev.toString().length(),300)));
                if("response.completed".equals(type)){complete=true;break;}
            }
            if(!complete)throw new Exception("Response stream ended before completion");
            return result.toString();
        }
    }
    @JavascriptInterface public void logout(){io.execute(()->{
        // Local sign-out; remote refresh-token revocation requires confirmation.
        activity.getSharedPreferences(PREF,Context.MODE_PRIVATE).edit().remove("profile").apply();
        record("signedout","הנתונים המקומיים נוקו. ביטול הרשאות בצד השרת לא אומת.");
    });}
    void shutdown(){closeServer();io.shutdownNow();}
}
