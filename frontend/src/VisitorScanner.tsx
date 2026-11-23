import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import ResidentDialog from './ResidentDialog'
export default function VisitorScanner({onClose,onSearch,onScan,scanError,busy}:{onClose:()=>void;onSearch:()=>void;onScan:(token:string)=>void;scanError:string;busy:boolean}){
  const video=useRef<HTMLVideoElement>(null),controls=useRef<IScannerControls|null>(null)
  const [camera,setCamera]=useState(false),[error,setError]=useState(''),[code,setCode]=useState('')
  useEffect(()=>{
    if(!camera)return
    let active=true
    if(!navigator.mediaDevices?.getUserMedia){
      const timer=window.setTimeout(()=>{setError('Camera scanning is unavailable. Enter the pass code or search the logbook.');setCamera(false)},0)
      return ()=>window.clearTimeout(timer)
    }
    new BrowserQRCodeReader().decodeFromVideoDevice(undefined,video.current!, (result,_error,c)=>{
      if(result&&active){active=false;c.stop();setCamera(false);onScan(result.getText())}
    }).then(c=>{if(active)controls.current=c;else c.stop()}).catch(()=>{
      if(active){setError('Camera unavailable or permission denied. Use manual pass entry or record search.');setCamera(false)}
    })
    return ()=>{active=false;controls.current?.stop();controls.current=null}
  },[camera,onScan])
  return <ResidentDialog title="Scan visitor pass" onClose={onClose} busy={busy} protectEdits={false} footerNote="Use a Haruhay visitor pass. You’ll confirm entry or exit after reviewing the visit.">
    <div className="visitor-camera">
      {camera ? <><video ref={video} autoPlay muted playsInline aria-label="QR camera preview" /><button className="admin-secondary" onClick={()=>setCamera(false)}>Stop camera</button></>
        : <button className="admin-primary" disabled={busy} onClick={()=>{setError('');setCamera(true)}}>{error?'Retry camera':'Start camera'}</button>}
    </div>
    {error&&<p role="alert" className="admin-error">{error}</p>}
    {scanError&&<p role="alert" className="admin-error">{scanError}</p>}
    <form className="visitor-form" onSubmit={e=>{e.preventDefault();setCamera(false);onScan(code.trim())}}>
      <label>Enter a pass code<textarea autoComplete="off" required value={code} onChange={e=>setCode(e.target.value)} placeholder="haruhay:visit:…" maxLength={100}/></label>
      <div className="visitor-actions"><button className="admin-primary" disabled={busy||!code.trim()}>{busy?'Checking pass…':'Validate pass'}</button><button className="admin-secondary" type="button" disabled={busy} onClick={onSearch}>Search logbook instead</button></div>
    </form>
  </ResidentDialog>
}
