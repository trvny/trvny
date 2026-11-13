// Native scroll snapping; no carousel dependencies or offscreen animation.
function setupRail(trackId, dotsId, delay) {
  const track=document.getElementById(trackId);
  const nav=document.getElementById(dotsId);
  if(!track||!nav)return;
  const slides=[...track.children],buttons=[...nav.querySelectorAll("button[data-slide]")];
  const mobile=matchMedia("(max-width:640px)");
  const reduced=matchMedia("(prefers-reduced-motion:reduce)");
  let visible=false,pauseUntil=0,frame=0,paused=false;
  const toggle=nav.querySelector("[data-rail-toggle]");
  if(toggle){
    toggle.hidden=reduced.matches;
    toggle.addEventListener("click",()=>{
      paused=!paused;
      toggle.textContent=paused?"Resume":"Pause";
      toggle.setAttribute("aria-label",paused?"Resume automatic rotation":"Pause automatic rotation");
    });
    if(typeof reduced.addEventListener==="function")reduced.addEventListener("change",()=>{toggle.hidden=reduced.matches;});
  }
  const select=index=>buttons.forEach((button,i)=>button.setAttribute("aria-pressed",String(i===index)));
  function current(){
    const first=slides[0].offsetLeft;
    let best=0,distance=Infinity;
    slides.forEach((slide,i)=>{
      const delta=Math.abs(slide.offsetLeft-first-track.scrollLeft);
      if(delta<distance){best=i;distance=delta;}
    });
    return best;
  }
  function show(index){
    track.scrollTo({left:slides[index].offsetLeft-slides[0].offsetLeft,
      behavior:reduced.matches?"auto":"smooth"});
    select(index);
  }
  buttons.forEach((button,i)=>button.addEventListener("click",()=>{pauseUntil=Date.now()+delay*2;show(i);}));
  ["pointerdown","touchstart","wheel","keydown"].forEach(type=>
    track.addEventListener(type,()=>{pauseUntil=Date.now()+delay*2;},{passive:true}));
  let touchStart=null;
  track.addEventListener("touchstart",event=>{
    const touch=event.touches[0];
    if(!mobile.matches||!touch||event.target.closest("input, select, button, audio")){touchStart=null;return;}
    const max=Math.max(0,track.scrollWidth-track.clientWidth);
    touchStart={x:touch.clientX,y:touch.clientY,atStart:track.scrollLeft<=2,atEnd:track.scrollLeft>=max-2};
  },{passive:true});
  track.addEventListener("touchend",event=>{
    const touch=event.changedTouches[0],start=touchStart;
    touchStart=null;
    if(!start||!touch)return;
    const dx=touch.clientX-start.x,dy=touch.clientY-start.y;
    if(Math.abs(dx)<50||Math.abs(dx)<Math.abs(dy)*1.2)return;
    if(start.atEnd&&dx<0)show(0);
    else if(start.atStart&&dx>0)show(slides.length-1);
  },{passive:true});
  track.addEventListener("touchcancel",()=>{touchStart=null;},{passive:true});
  track.addEventListener("scroll",()=>{
    if(frame)return;
    frame=requestAnimationFrame(()=>{frame=0;if(mobile.matches)select(current());});
  },{passive:true});
  if("IntersectionObserver" in window){
    const observer=new IntersectionObserver(entries=>{
      visible=entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>=.35);
    },{threshold:[0,.35]});
    observer.observe(track);
  }else{visible=true;}
  setInterval(()=>{
    const focused=document.activeElement;
    const keyboardFocus=focused&&((track.contains(focused)&&focused.matches("input, select, :focus-visible"))||
      (nav.contains(focused)&&focused.matches(":focus-visible")));
    if(paused||!mobile.matches||reduced.matches||document.hidden||!visible||Date.now()<pauseUntil||keyboardFocus||slides.some(slide=>slide.matches?.('[data-radio][data-playing="true"]')))return;
    show((current()+1)%slides.length);
  },delay);
}
setupRail("featureRail","featureDots",10000);
setupRail("benchRail","benchDots",19000);
