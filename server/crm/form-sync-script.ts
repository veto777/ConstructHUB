/**
 * The form-sync script a contractor pastes on their own website (served at GET /form-sync.js, see
 * server/crm/leads.ts). Plain ES5, no dependencies, under 4 KB.
 *
 *   <script src="https://portal.constructhub.us/form-sync.js" data-token="<TOKEN>" async></script>
 *
 * What it does (two ways in, one way out):
 * - Plain HTML forms: a `submit` listener in the capture phase on document (forms added later included). It reads
 *   the form's named (or id'd) inputs, skipping password/file/buttons. A form or parent with data-ch-skip is left
 *   alone; role="search" forms too.
 * - Sites that send with JavaScript (the owner's React sites: preventDefault, then fetch POST JSON to /api/contact,
 *   inputs with no name; the PHP sites: fetch + FormData to /submit.php): window.fetch and XMLHttpRequest.send are
 *   wrapped. A same-origin POST whose body is JSON, FormData or URLSearchParams and looks like a lead (an email
 *   value, or a key like email/phone/tel/mobile) is copied. The wrapper never touches the original request or its
 *   response and never waits for it: a lead the site's own server answers with a 400 is still captured.
 * - Where they came from: on the landing page the script reads utm_*, the ad click ids (gclid, gbraid, wbraid, fbclid,
 *   msclkid, ttclid), the referrer when it is another site, and the landing URL, and keeps them in sessionStorage for
 *   the tab (first touch wins, so a form on /contact/ still carries the ad that brought the visitor). They ride along
 *   with every lead as `attribution`; the server stores them as _-prefixed fields and names the channel
 *   (server/crm/lead-channel.ts). Nothing is read from cookies and nothing identifies the visitor.
 * - Out: sensitive names dropped, honeypots checked (company_url or website filled = a bot, nothing is sent), then
 *   one sendBeacon (fetch keepalive as the fallback) 0.8 s later. Copies of one submission within that window (the
 *   submit event plus the fetch it triggers) are merged by email/phone and sent once; the same contact is not sent
 *   again within 3 s. A page that unloads first flushes on pagehide.
 * - window.ConstructHUBForms.send({ name, email, ... }) for anything else (a site that posts cross-origin, or
 *   builds its body in a way the wrapper cannot read).
 *
 * The same sensitive-name rule is enforced again on the server (SENSITIVE_FIELD in leads.ts); this copy only keeps
 * those values from leaving the visitor's browser at all.
 */

/** Field names the script and the server never keep. */
export const SENSITIVE_FIELD_SOURCE = "pass|card|cc[-_]?(?:num|no|exp)|^cc$|cc-|cvv|cvc|cv2|cvn|security[-_]?code|expir|routing|account[-_]?(?:num|no)|iban|ssn|social|token|csrf|captcha|recaptcha|g-recaptcha|honeypot|nonce";

/** The same rule, shorter: "captcha" already covers recaptcha and g-recaptcha. */
const SCRIPT_SENSITIVE = SENSITIVE_FIELD_SOURCE.replace("|recaptcha|g-recaptcha", "");

/** Honeypot fields of the owner's sites: a bot fills them, a person never sees them. Either one set = drop it. */
export const HONEYPOT_FIELDS = ["company_url", "website"] as const;

export function formSyncScript(apiOrigin: string): string {
  const endpoint = JSON.stringify(`${apiOrigin.replace(/\/+$/, "")}/api/public/form-sync/`);
  // Kept small by hand: no build step, so the file served is exactly what is reviewed here.
  return `/* ConstructHUB form sync */
(function(w,d){
if(w.ConstructHUBForms)return;
var s=d.currentScript||d.querySelector('script[src*="form-sync.js"][data-token]');
var t=s&&s.getAttribute("data-token");if(!t)return;
var B=${endpoint},E=B+encodeURIComponent(t),F=w.fetch,L=location;
var BD=/${SCRIPT_SENSITIVE}/i,SK=/^(password|file|submit|button|reset|image)$/i,HP=${JSON.stringify(HONEYPOT_FIELDS)},CT=/e-?mail|phone|tel|mobile|cell/i,AT=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
var P={},S={},A={};
/* Where the visitor came from, read once on the landing page and kept for the tab (first touch wins):
   utm_* and ad click ids from the URL, the referrer when it is another site, and the landing URL. */
try{var ss=w.sessionStorage,sv=ss&&ss.getItem("ch_attr");if(sv)A=JSON.parse(sv)||{};
else{var K=["utm_source","utm_medium","utm_campaign","gclid","gbraid","wbraid","fbclid","msclkid","ttclid"],qs=new URLSearchParams(L.search||""),rf=d.referrer||"",n=0,i,v;
for(i=0;i<K.length;i++){v=qs.get(K[i]);if(v){A[K[i]]=v.slice(0,200);n++;}}
if(rf&&rf.indexOf(L.origin+"/")!=0&&rf!=L.origin){A.referrer=rf.slice(0,500);n++;}
if(n){A.landing=String(L.href).slice(0,500);ss&&ss.setItem("ch_attr",JSON.stringify(A));}}}catch(e){A={};}
function cl(o){var r={},n=0,k,v;for(k in o){if(BD.test(k))continue;v=o[k];if(v==null||typeof v=="object")continue;v=String(v).replace(/^\\s+|\\s+$/g,"").slice(0,2000);if(!v)continue;if(++n>60)break;r[String(k).slice(0,100)]=v;}return r;}
function who(f){var e="",p="",k;for(k in f){if(!e&&AT.test(f[k]))e=f[k].toLowerCase();else if(!p&&CT.test(k)){p=f[k].replace(/\\D/g,"").slice(-10);}}return e||p?e+"|"+p:"";}
function bc(k){var q=P[k];if(!q)return;delete P[k];clearTimeout(q.t);S[k]=+new Date();
var y=JSON.stringify({fields:q.f,pageUrl:L.href.slice(0,500),title:d.title.slice(0,200),formId:q.m.formId||null,formName:q.m.formName||null,attribution:A});
try{if(navigator.sendBeacon&&navigator.sendBeacon(E,new Blob([y],{type:"text/plain"})))return;}catch(e){}
try{F&&F.call(w,E,{method:"POST",body:y,keepalive:true,mode:"no-cors"})["catch"](function(){});}catch(e){}}
function sd(fs,mt){try{
var r0=fs||{},i;for(i=0;i<HP.length;i++)if(r0[HP[i]]&&String(r0[HP[i]]).replace(/\\s/g,""))return false;
var f=cl(r0);if(!Object.keys(f).length)return false;
var k=who(f)||JSON.stringify(f),now=+new Date(),q=P[k];
if(S[k]&&now-S[k]<3000)return false;
if(q){for(i in f)q.f[i]=f[i];clearTimeout(q.t);}else q=P[k]={f:f,m:mt||{}};
q.t=setTimeout(function(){bc(k);},800);return true;
}catch(e){}return false;}
function fl(){for(var k in P)bc(k);}
w.addEventListener("pagehide",fl);
function pr(b){var o={};b.forEach(function(v,k){if(typeof v=="string"&&v)o[k]=o[k]?o[k]+", "+v:v;});return o;}
function parse(b){if(!b)return null;
if(typeof b=="string"){try{var j=JSON.parse(b);if(j&&typeof j=="object"&&!j.length){var o={},k,x;for(k in j){x=j[k];if(x&&typeof x=="object"&&!x.length){for(var m in x)if(!(m in o))o[m]=x[m];}else o[k]=x;}return o;}}catch(e){}
return /^[^{\\[\\s][^=&]*=/.test(b)?pr(new URLSearchParams(b)):null;}
return b.forEach?pr(b):null;}
function ld(o){for(var k in o)if(o[k]&&(CT.test(k)||AT.test(String(o[k]))))return true;return false;}
function mn(u){try{var x=new URL(u,L.href);return x.origin==L.origin&&String(x.href).indexOf(B)<0?x.pathname:null;}catch(e){return null;}}
function sn(m,u,b){try{if(String(m||"GET").toUpperCase()!="POST")return;var p=mn(u);if(!p)return;var o=parse(b);if(o&&ld(o))sd(o,{formName:p});}catch(e){}}
if(F)w.fetch=function(i,o){try{if(typeof i=="string"||i instanceof URL)sn(o&&o.method,String(i),o&&o.body);else if(i&&i.clone&&i.method=="POST")i.clone().text().then(function(b){sn("POST",i.url,b);},function(){});}catch(e){}return F.apply(this,arguments);};
var X=w.XMLHttpRequest&&w.XMLHttpRequest.prototype;
if(X){var xo=X.open,xs=X.send;X.open=function(m,u){try{this.__ch=[m,String(u)];}catch(e){}return xo.apply(this,arguments);};
X.send=function(b){try{if(this.__ch)sn(this.__ch[0],this.__ch[1],b);}catch(e){}return xs.apply(this,arguments);};}
function rd(fm){var o={},es=fm.elements||[],i,el,n,ty,v;
for(i=0;i<es.length;i++){el=es[i];n=el.name||el.id;if(!n||el.disabled)continue;
ty=String(el.type||"").toLowerCase();if(SK.test(ty)||BD.test(String(el.autocomplete||"")))continue;
if((ty=="checkbox"||ty=="radio")&&!el.checked)continue;
v=el.value;
if(v==null||v==="")continue;o[n]=o[n]?o[n]+", "+v:v;}
return o;}
d.addEventListener("submit",function(ev){try{var f=ev.target;if(!f||f.tagName!="FORM")return;
if(f.closest("[data-ch-skip]"))return;
if(f.getAttribute("role")=="search")return;
sd(rd(f),{formId:f.id||null,formName:f.getAttribute("name")});
}catch(e){}},true);
w.ConstructHUBForms={send:function(f,m){return sd(f,m);},version:2};
})(window,document);
`;
}
