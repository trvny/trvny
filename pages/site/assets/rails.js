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
    if(paused||!mobile.matches||reduced.matches||document.hidden||!visible||Date.now()<pauseUntil||track.contains(document.activeElement)||nav.contains(document.activeElement))return;
    show((current()+1)%slides.length);
  },delay);
}
setupRail("featureRail","featureDots",10000);
setupRail("benchRail","benchDots",19000);
