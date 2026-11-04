package il.atmos.weather;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
public class MainActivity extends Activity {
 private WebView view;
 @Override public void onCreate(Bundle b){ super.onCreate(b); view=new WebView(this);setContentView(view); view.getSettings().setJavaScriptEnabled(true);view.getSettings().setDomStorageEnabled(true);
 WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
 view.setWebViewClient(new WebViewClientCompat(){@Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return loader.shouldInterceptRequest(r.getUrl());}});
 view.setWebChromeClient(new WebChromeClient());view.loadUrl("https://appassets.androidplatform.net/assets/index.html");}
 @Override public void onBackPressed(){if(view.canGoBack())view.goBack();else super.onBackPressed();}
}