package il.atmos.weather;
import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;
import java.util.concurrent.Executor;

/** On-demand location. Never requests location until the user taps My Location. */
public final class AtmosLocationNative {
 static final int PERMISSION_REQUEST=7212;
 private final Activity activity;
 private final WebView web;
 private final Handler handler=new Handler(Looper.getMainLooper());
 AtmosLocationNative(Activity activity,WebView web){this.activity=activity;this.web=web;}
 @JavascriptInterface public void locate(){handler.post(()->{
  if(Build.VERSION.SDK_INT>=23 &&
    activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED &&
    activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
   activity.requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
     Manifest.permission.ACCESS_COARSE_LOCATION},PERMISSION_REQUEST);return;
  }
  getLocation();
 });}
 void onPermissionResult(int requestCode){
  if(requestCode!=PERMISSION_REQUEST)return;
  if(Build.VERSION.SDK_INT>=23 &&
    activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED &&
    activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
    result(null,"Location permission denied");return;
  }
  getLocation();
 }
 private void result(Location loc,String error){
  final String script="window.atmosLocationResult("+
   (loc==null?"null":String.valueOf(loc.getLatitude()))+","+
   (loc==null?"null":String.valueOf(loc.getLongitude()))+","+
   JSONObject.quote(error==null?"":error)+");";
  handler.post(()->web.evaluateJavascript(script,null));
 }
 private void getLocation(){
  try{
   LocationManager lm=(LocationManager)activity.getSystemService(Activity.LOCATION_SERVICE);
   if(lm==null){result(null,"Location service unavailable");return;}
   Location best=null;
   for(String provider:lm.getProviders(true)){
    try{
     Location item=lm.getLastKnownLocation(provider);
     if(item!=null && (best==null||item.getTime()>best.getTime()))best=item;
    }catch(SecurityException ignored){}
   }
   if(best!=null && System.currentTimeMillis()-best.getTime()<900000L){
    result(best,null);return;
   }
   final Location fallback=best;
   if(Build.VERSION.SDK_INT>=30){
    String provider=lm.isProviderEnabled(LocationManager.GPS_PROVIDER)?
      LocationManager.GPS_PROVIDER:LocationManager.NETWORK_PROVIDER;
    lm.getCurrentLocation(provider,null,(Executor)handler::post,
      loc->result(loc==null?fallback:loc,loc==null&&fallback==null?"No current location":""));
   }else{
    result(fallback,fallback==null?"No recent location fix":"");
   }
  }catch(SecurityException e){result(null,"Location permission not granted");}
   catch(Exception e){result(null,"Unable to obtain location");}
 }
}