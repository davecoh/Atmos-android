package il.atmos.weather;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.content.Intent;
import android.net.Uri;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
public class MainActivity extends Activity {
 private WebView view;
 private IMSNative ims;
 private ChatGPTNative chat;
 @Override public void onCreate(Bundle b){ super.onCreate(b); view=new WebView(this);setContentView(view); view.getSettings().setJavaScriptEnabled(true);view.getSettings().setDomStorageEnabled(true);ims = new IMSNative(this,view);view.addJavascriptInterface(ims,"AtmosIMS");chat=new ChatGPTNative(this,view);view.addJavascriptInterface(chat,"AtmosGPT");
 WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
 view.setWebViewClient(new WebViewClientCompat(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){Uri uri=request.getUrl();if("https".equals(uri.getScheme())&&"appassets.androidplatform.net".equals(uri.getHost()))return false;startActivity(new Intent(Intent.ACTION_VIEW,uri));return true;}
 @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return loader.shouldInterceptRequest(r.getUrl());}});
 view.setWebChromeClient(new WebChromeClient());view.loadUrl("https://appassets.androidplatform.net/assets/index.html");}
 @Override protected void onDestroy(){if(ims!=null)ims.shutdown();if(chat!=null)chat.shutdown();if(view!=null)view.destroy();super.onDestroy();}
 @Override public void onBackPressed(){if(view.canGoBack())view.goBack();else super.onBackPressed();}
}