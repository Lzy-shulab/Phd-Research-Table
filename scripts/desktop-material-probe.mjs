import { _electron as electron } from 'playwright'
import { resolve,join } from 'node:path'
import { mkdirSync,writeFileSync } from 'node:fs'
const out=resolve('test-results/material-probe');mkdirSync(out,{recursive:true})
writeFileSync(join(out,'panel.html'),`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}main{width:100%;height:100%;background:rgba(39,39,39,.68);color:#f5f3ee;padding:32px;font:20px 'Microsoft YaHei UI';backdrop-filter:blur(24px)}h1{font-size:24px;margin:0 0 40px}svg{width:160px;height:160px;display:block;margin:80px auto;fill:none;stroke:#d7bf89;stroke-width:8}p{color:#c4c2bd}</style></head><body><main><h1>面板材质检查</h1><p>原生窗口 / 圆弧边界</p><svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="64"/></svg></main></body></html>`)
const env={...process.env,WORKBENCH_DATA_DIR:join(out,'profile'),WORKBENCH_DISABLE_NOTIFICATIONS:'1'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:resolve('release/win-unpacked/PhD 科研工作台.exe'),args:[],env})
try {
  await app.firstWindow()
  const variants=[
    {name:'native-only',transparent:false,thickFrame:true,hasShadow:false,backgroundMaterial:'acrylic',radius:0},
    {name:'native-radius8',transparent:false,thickFrame:true,hasShadow:false,backgroundMaterial:'acrylic',radius:8}
  ]
  for(const variant of variants){
    const shot=await app.evaluate(async ({BrowserWindow,desktopCapturer,screen},{variant,file})=>{
      for(const w of BrowserWindow.getAllWindows())w.hide()
      const area=screen.getPrimaryDisplay().workArea,display=screen.getPrimaryDisplay()
      const {name,shape,radius,...options}=variant
      const w=new BrowserWindow({title:name,width:480,height:720,x:area.x+area.width-700,y:area.y+40,frame:false,show:false,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,...options})
      if(shape){const r=24,rects=[{x:0,y:r,width:480,height:720-2*r}];for(let y=0;y<r;y++){const i=Math.ceil(r-Math.sqrt(r*r-(r-y-.5)**2));rects.push({x:i,y,width:480-i*2,height:1},{x:i,y:719-y,width:480-i*2,height:1})}w.setShape(rects)}
      await w.loadFile(file);await w.webContents.executeJavaScript(`document.querySelector('main').style.borderRadius='${radius}px';document.querySelector('main').style.border='none'`);w.show();w.focus();await new Promise(r=>setTimeout(r,500))
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}})
      const image=sources.find(s=>s.display_id===String(display.id))?.thumbnail ?? sources[0].thumbnail
      const bounds=w.getBounds(),ratio=image.getSize().width/display.bounds.width
      const rect={x:Math.max(0,Math.round((bounds.x-display.bounds.x-12)*ratio)),y:Math.max(0,Math.round((bounds.y-display.bounds.y-12)*ratio)),width:Math.round((bounds.width+24)*ratio),height:Math.round((bounds.height+24)*ratio)}
      const result=image.crop(rect).toPNG().toString('base64');w.destroy();return result
    },{variant,file:join(out,'panel.html')})
    writeFileSync(join(out,variant.name+'.png'),Buffer.from(shot,'base64'));console.log('CAPTURED',variant.name)
  }
} finally {await app.close()}
