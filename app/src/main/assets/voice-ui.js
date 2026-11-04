/* Atmos voice chat: per-turn Hebrew recognition and spoken responses, no separate OpenAI API billing. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
let listening=false,waiting=false,lastAnswer="",voiceTurn=false;
function setStatus(message){const el=$('voiceStatus');if(el)el.textContent=message;}
function sync(){
 const ask=$('voiceAsk');if(!ask)return;
 ask.classList.toggle('listening',listening);
 ask.textContent=listening?'🎙️ מקשיב…':'🎙️ דבר עם אטמוס';
 ask.disabled=waiting||listening;
 $('voiceReplay').disabled=!lastAnswer;
}
function stop(){
 try{window.AtmosVoice?.stop();}catch(e){}
 listening=false;voiceTurn=false;
 setStatus('ההקראה נעצרה. אפשר לשאול שוב 🎙️');
 sync();
}
function ask(){
 if(waiting){setStatus('אטמוס עדיין מכין תשובה לשאלה הקודמת ☁️');return;}
 if(!window.AtmosVoice){setStatus('השיחה הקולית זמינה באפליקציית Android בלבד.');return;}
 window.AtmosVoice.stop();
 listening=true;voiceTurn=true;lastAnswer=lastAnswer||'';
 setStatus('מקשיב לך… 🎙️');
 sync();
 try{window.AtmosVoice.listen();}catch(e){
   listening=false;voiceTurn=false;setStatus('לא הצלחתי לפתוח את המיקרופון.');sync();
 }
}
window.atmosVoiceRecognized=text=>{
 listening=false;
 const question=String(text||'').trim();
 if(!question){voiceTurn=false;setStatus('לא שמעתי שאלה. ננסה שוב?');sync();return;}
 $('chatInput').value=question;
 if(waiting){voiceTurn=false;setStatus('אטמוס עסוק כרגע. אפשר לנסות שוב עוד מעט.');sync();return;}
 waiting=true;
 setStatus('שמעתי: '+question+' · חושב על תשובה ☁️');
 sync();
 Promise.resolve(window.AtmosGPTChat.send(question,{spoken:true}))
 .catch(()=>{waiting=false;voiceTurn=false;setStatus('לא הצלחתי להשלים את השאלה. אפשר לנסות שוב.');sync();});
};
window.atmosVoiceCancelled=()=>{
 listening=false;voiceTurn=false;
 setStatus('אין בעיה, אפשר לדבר כשתרצה 🙂');sync();
};
window.atmosVoiceError=message=>{
 listening=false;waiting=false;voiceTurn=false;
 setStatus(message||'משהו השתבש בקול. אפשר לנסות שוב.');sync();
};
window.atmosVoiceReady=availability=>{
 if(availability==='unavailable')setStatus('זיהוי דיבור מוכן; כדי לשמוע תשובות בעברית יש להתקין קול עברי בהגדרות הטלפון.');
};
function onAnswer(answer,spoken){
 if(!spoken)return;
 waiting=false;listening=false;voiceTurn=false;
 lastAnswer=String(answer||'').trim();
 if(lastAnswer){
   setStatus('אטמוס עונה בקול 🔊');
   try{window.AtmosVoice?.speak(lastAnswer);}catch(e){setStatus('התשובה מופיעה בצ׳אט, אבל ההקראה לא הופעלה.');}
 }else setStatus('התשובה מופיעה בצ׳אט.');
 sync();
}
window.AtmosVoiceUI={
 setup(){
  $('voiceAsk').onclick=ask;
  $('voiceStop').onclick=stop;
  $('voiceReplay').onclick=()=>{
    if(!lastAnswer)return;
    setStatus('משמיע שוב 🔊');
    try{window.AtmosVoice?.speak(lastAnswer);}catch(e){setStatus('לא ניתן להשמיע כרגע.');}
  };
  if(!window.AtmosVoice){$('voiceAsk').disabled=true;setStatus('שיחה קולית זמינה באפליקציית Android בלבד.');}
  sync();
 },
 onAnswer
};
})();