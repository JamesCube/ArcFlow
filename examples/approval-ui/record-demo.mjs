// Genuine Chromium screencast. Authentication happens before capture; no traces/HAR.
import { chromium, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const output = resolve('demo-output'), raw = resolve('demo-frames')
mkdirSync(output,{recursive:true}); mkdirSync(raw,{recursive:true})
const browser = await chromium.launch()
const page = await browser.newPage({viewport:{width:1440,height:1080},deviceScaleFactor:1})
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const pause = ms=>page.waitForTimeout(ms)
const chunks=[]
async function login(user){
 await page.goto('http://127.0.0.1:5173')
 await page.getByLabel('Demo account').selectOption(user)
 await page.getByLabel('Password',{exact:true}).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`])
 await page.getByRole('button',{name:'Enter workspace'}).click()
 await expect(page.getByRole('heading',{name:'Leave approvals',exact:true})).toBeVisible()
}
async function logout(){await page.getByRole('button',{name:'Sign out',exact:true}).click()}
async function record(label,action){
 await expect(page.getByLabel('Password',{exact:true})).toHaveCount(0)
 await pause(400)
 const cdp=await page.context().newCDPSession(page), frames=[]
 const start=Date.now()
 cdp.on('Page.screencastFrame',async event=>{
  const name=`${raw}/${chunks.length}-${frames.length}.jpg`
  writeFileSync(name,Buffer.from(event.data,'base64'))
  frames.push({name,time:Date.now()})
  await cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId})
 })
 await cdp.send('Page.startScreencast',{format:'jpeg',quality:95,maxWidth:1440,maxHeight:1080,everyNthFrame:1})
 await pause(700);await action();await pause(800)
 await cdp.send('Page.stopScreencast');const end=Date.now();await cdp.detach()
 if(!frames.length)throw Error('No actual browser frames captured')
 const list=frames.map((f,i)=>`file '${f.name}'\nduration ${((frames[i+1]?.time||end)-f.time)/1000}`).join('\n')+`\nfile '${frames.at(-1).name}'\n`
 const path=`${raw}/${chunks.length}.txt`;writeFileSync(path,list)
 const target=`${raw}/${chunks.length}.mp4`
 const vf=`pad=iw:ih+96:0:0:color=0x10213c,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${label}':x=34:y=h-72:fontsize=25:fontcolor=white,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='ArcFlow | Real local experimental demo | Synthetic data | Sign-in transitions omitted':x=34:y=h-33:fontsize=16:fontcolor=0xbacbe0`
 const res=spawnSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',path,'-vf',vf,'-r','25','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p',target],{stdio:'inherit'})
 if(res.status)throw Error('ffmpeg encode failed');chunks.push(target)
 console.log(`Captured ${label}: ${((end-start)/1000).toFixed(1)} seconds`)
}
try{
 await login('alice')
 await page.getByTestId('process-tab').click()
 await page.getByTestId('process-name').fill('Two-step leave approval')
 await page.getByLabel('Step 1 name',{exact:true}).fill('Team review')
 await page.getByTestId('add-step').click()
 await page.getByLabel('Step 2 name',{exact:true}).fill('Final review')
 await page.getByLabel('Step 2 approver',{exact:true}).selectOption('carol')
 await page.getByTestId('publish').click()
 await expect(page.getByRole('status')).toContainText('Template v2 published')
 await page.keyboard.press('Control+Home')
 await record('01  Published workflow | Team review - Bob / Final review - Carol',async()=>{
  await pause(1500);await page.mouse.wheel(0,520);await pause(1800);await page.mouse.wheel(0,440);await pause(1800)
 })
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/Requests/}).click()
 await page.keyboard.press('Control+Home')
 await record('02  Alice submits | The published v2 sequence is saved with the request',async()=>{
  await page.getByLabel('Title',{exact:true}).pressSequentially('Demo leave request',{delay:55})
  await page.getByLabel('Days',{exact:true}).fill('2')
  await page.getByLabel('Reason',{exact:true}).pressSequentially('Synthetic example for the ArcFlow demo.',{delay:35})
  await pause(700);await page.getByRole('button',{name:'Submit request',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Request submitted');await pause(2200)
 })
 await logout();await login('bob')
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/Needs my review/}).click()
 await page.getByRole('button').filter({has:page.getByText('Demo leave request',{exact:true})}).click()
 await record('03  Bob approves step 1 | Carol becomes the current approver',async()=>{
  await pause(1500);await page.getByRole('button',{name:'Approve step',exact:true}).scrollIntoViewIfNeeded();await pause(1700)
  await page.getByRole('button',{name:'Approve step',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('still pending')
  await page.keyboard.press('Control+Home');await pause(2300)
 })
 await logout();await login('carol')
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/Needs my review/}).click()
 await page.getByRole('button').filter({has:page.getByText('Demo leave request',{exact:true})}).click()
 await record('04  Carol gives final approval | Completed sequence and decision history',async()=>{
  await pause(1500);await page.getByRole('button',{name:'Approve request',exact:true}).scrollIntoViewIfNeeded();await pause(1500)
  await page.getByRole('button',{name:'Approve request',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('Request approved.')
  await page.keyboard.press('Control+Home');await pause(2000)
  await page.locator('.timeline').scrollIntoViewIfNeeded();await pause(4000)
 })
 await expect(page.locator('.timeline li')).toHaveCount(3)
 await expect(page.locator('.detail > .card-heading .status')).toHaveText('approved')
 await expect(page.getByLabel('Password',{exact:true})).toHaveCount(0)
 await page.screenshot({path:`${output}/ArcFlow-demo-poster.png`,fullPage:true})
 if(errors.length)throw Error('Browser console errors: '+errors.join('; '))
 writeFileSync(`${raw}/all.txt`,chunks.map(p=>`file '${p}'`).join('\n'))
 if(spawnSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',`${raw}/all.txt`,'-c','copy','-movflags','+faststart',`${output}/ArcFlow-demo.mp4`],{stdio:'inherit'}).status)throw Error('Concat failed')
 const info=spawnSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,width,height,pix_fmt','-of','json',`${output}/ArcFlow-demo.mp4`],{encoding:'utf8'})
 writeFileSync(`${output}/verification.json`,info.stdout)
 const duration=Number(JSON.parse(info.stdout).format.duration)
 if(duration<30||duration>60)throw Error('Expected 30-60 second demo; got '+duration)
 writeFileSync(`${output}/PROVENANCE.txt`,`ArcFlow actual standalone UI recording\nCommit: ${process.env.GITHUB_SHA||'local'}\nBase app source: 68cf0f544250eef34f1f6f00943c5650e584cbbb\nCapture: Chromium DevTools screencast, actual frame timings, 25fps MP4. No sped-up sections.\nOnly authenticated UI captured; sign-ins and role-switch transitions omitted. No API stubs, mocked UI, traces, HAR or session exports. Synthetic leave request.\nVerified: published v2 two-step process, Alice submission, Bob first approval, Carol final approval, approved status, three history entries, zero page errors.\n${info.stdout}`)
}finally{await browser.close();rmSync(raw,{recursive:true,force:true})}
