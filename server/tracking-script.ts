import type { Express } from "express";

export function registerTrackingRoutes(app: Express) {
  app.get("/api/click-guard/script/:trackingId", (req, res) => {
    const { trackingId } = req.params;
    const apiUrl = "https://constructhub.us";

    const script = `(function(){
  if(window.__chClickGuardLoaded)return;
  window.__chClickGuardLoaded=true;
  var tid="${trackingId}";
  var api="${apiUrl}/api/click-guard/track";
  function fp(){
    try{
      var c=document.createElement("canvas");
      c.width=200;c.height=50;
      var ctx=c.getContext("2d");
      if(!ctx)return"no-canvas";
      ctx.textBaseline="top";
      ctx.font="14px Arial";
      ctx.fillStyle="#f60";
      ctx.fillRect(0,0,62,20);
      ctx.fillStyle="#069";
      ctx.fillText("ConstructHUB",2,15);
      ctx.fillStyle="rgba(102,204,0,0.7)";
      ctx.fillText("ClickGuard",4,17);
      ctx.globalCompositeOperation="multiply";
      ctx.fillStyle="rgb(255,0,255)";
      ctx.beginPath();
      ctx.arc(50,25,25,0,Math.PI*2,true);
      ctx.closePath();
      ctx.fill();
      var d=c.toDataURL();
      var h=0;
      for(var i=0;i<d.length;i++){
        h=((h<<5)-h)+d.charCodeAt(i);
        h=h&h;
      }
      return Math.abs(h).toString(36);
    }catch(e){return"err-"+Math.random().toString(36).substr(2,6);}
  }
  function getDeviceType(){
    var ua=navigator.userAgent;
    if(/Mobi|Android.*Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua))return"mobile";
    if(/iPad|Android(?!.*Mobile)|Tablet/i.test(ua))return"tablet";
    return"desktop";
  }
  function getBrowser(){
    var ua=navigator.userAgent;
    if(ua.indexOf("Firefox")>-1)return"Firefox";
    if(ua.indexOf("SamsungBrowser")>-1)return"Samsung";
    if(ua.indexOf("Opera")>-1||ua.indexOf("OPR")>-1)return"Opera";
    if(ua.indexOf("Trident")>-1)return"IE";
    if(ua.indexOf("Edg")>-1)return"Edge";
    if(ua.indexOf("Chrome")>-1)return"Chrome";
    if(ua.indexOf("Safari")>-1)return"Safari";
    return"Other";
  }
  function getOS(){
    var ua=navigator.userAgent;
    if(ua.indexOf("Win")>-1)return"Windows";
    if(ua.indexOf("Mac")>-1)return"macOS";
    if(ua.indexOf("Linux")>-1)return"Linux";
    if(ua.indexOf("Android")>-1)return"Android";
    if(ua.indexOf("iPhone")>-1||ua.indexOf("iPad")>-1)return"iOS";
    return"Other";
  }
  function send(){
    var data={
      trackingId:tid,
      fingerprint:fp(),
      deviceType:getDeviceType(),
      browser:getBrowser(),
      os:getOS(),
      screenResolution:screen.width+"x"+screen.height,
      language:navigator.language||navigator.userLanguage||"",
      timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"",
      referrer:document.referrer||"",
      landingPage:window.location.href,
      userAgent:navigator.userAgent
    };
    var body=JSON.stringify(data);
    if(navigator.sendBeacon){
      navigator.sendBeacon(api,new Blob([body],{type:"application/json"}));
    }else{
      var xhr=new XMLHttpRequest();
      xhr.open("POST",api,true);
      xhr.setRequestHeader("Content-Type","application/json");
      xhr.send(body);
    }
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",send);
  }else{
    send();
  }
})();`;

    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(script);
  });
}
