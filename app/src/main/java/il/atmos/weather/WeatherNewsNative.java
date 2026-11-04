package il.atmos.weather;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.time.Instant;
import java.time.Duration;
import java.net.URL;
import java.net.HttpURLConnection;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;

/** Public, attributed Telegram previews. No user account, API token or paywall bypass. */
public class WeatherNewsNative {
 private final WebView view;
 private final Handler main = new Handler(Looper.getMainLooper());
 private final ExecutorService pool = Executors.newSingleThreadExecutor();
 private static final String[][] SOURCES={
  {"Weather2day", "weather2day"},
  {"שלמה מזג אוויר", "MezgAvirIL"},
  {"התחזית ישראל", "Israel_weather_channel"}
 };
 WeatherNewsNative(Activity activity,WebView web){view=web;}
 @JavascriptInterface public void refresh(String requestId){
  if(requestId==null||!requestId.matches("[a-zA-Z0-9_-]{1,40}"))return;
  pool.execute(()->{
   JSONArray posts=new JSONArray();
   JSONArray feeds=new JSONArray();
   Instant now=Instant.now();
   for(String[] source:SOURCES){
    JSONObject feed=new JSONObject();
    String channel=source[1],url="https://t.me/s/"+channel;
    try{
     feed.put("name",source[0]);feed.put("url",url);
     HttpURLConnection conn=(HttpURLConnection)new URL(url).openConnection();
     conn.setConnectTimeout(7000);conn.setReadTimeout(9000);
     conn.setRequestProperty("User-Agent","AtmosWeather/1.0 (+public weather updates)");
     int status=conn.getResponseCode();
     if(status!=200)throw new Exception("Source unavailable");
     int cap=850000;ByteArrayOutputStream bytes=new ByteArrayOutputStream();
     try(InputStream in=conn.getInputStream()){
      byte[] buffer=new byte[8192];int n;
      while((n=in.read(buffer))!=-1){bytes.write(buffer,0,n);if(bytes.size()>cap)throw new Exception("Too large");}
     }finally{conn.disconnect();}
     Document html=Jsoup.parse(bytes.toString("UTF-8"),url);
     Elements messages=html.select(".tgme_widget_message");
     int count=0;
     for(int i=messages.size()-1;i>=0&&count<3;i--){
      Element el=messages.get(i);
      Element time=el.selectFirst("time[datetime]");
      Element body=el.selectFirst(".tgme_widget_message_text");
      Element permalink=el.selectFirst("a.tgme_widget_message_date");
      if(time==null||body==null||permalink==null)continue;
      Instant when;
      try{when=Instant.parse(time.attr("datetime"));}catch(Exception ignore){continue;}
      long hours=Duration.between(when,now).toHours();
      if(hours<0||hours>72)continue;
      String text=body.text().replaceAll("\\s+"," ").trim();
      if(text.length()<20)continue;
      JSONObject post=new JSONObject();
      post.put("source",source[0]);post.put("time",when.toString());
      post.put("age_hours",hours);
      post.put("text",text.length()>280?text.substring(0,280)+"…":text);
      String link=permalink.absUrl("href");
      if(!link.startsWith("https://t.me/"))continue;
      post.put("url",link);
      posts.put(post);count++;
     }
     feed.put("available",true);feed.put("fresh_posts",count);
    }catch(Exception e){
     try{feed.put("name",source[0]);feed.put("url",url);feed.put("available",false);feed.put("fresh_posts",0);}catch(Exception ignore){}
    }
    feeds.put(feed);
   }
   JSONObject output=new JSONObject();
   try{output.put("checked_at",now.toString());output.put("max_age_hours",72);output.put("posts",posts);output.put("sources",feeds);}catch(Exception ignored){}
   String script="window.atmosNewsResult("+JSONObject.quote(requestId)+","+output.toString()+");";
   main.post(()->view.evaluateJavascript(script,null));
  });
 }
 void shutdown(){pool.shutdownNow();}
}
