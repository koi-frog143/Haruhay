import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import ResidentDialog from './ResidentDialog'
export default function VisitorScanner({onClose,onScan,scanError,busy}:{onClose:()=>void;onScan:(token:string)=>void;scanError:string;busy:boolean}){
  const video=useRef<HTMLVideoElement>(null),controls=useRef<IScannerControls|null>(null)
  const [camera,setCamera]=useState(false),[error,setError]=useState(''),[code,setCode]=useState('')
  useEffect(()=>{
    if(!camera)return
    let active=true
    if(!navigator.mediaDevices?.getUserMedia){setTimeout(()=>setError('Camera scanning is unavailable. Enter the pass code or search the logbook.'),0);return}
    new BrowserQRCodeReader().decodeFromVideoDevice(undefined,video.current!, (result,_error,c)=>{
      if(result&&active){active=false;c.stop();onScan(result.getText())}
    }).then(c=>{if(active)controls.current=c;else c.stop()}).catch(()=>{if(active)setError('Camera unavailable or permission denied. Use manual pass entry or record search.')})
    return ()=>{active=false;controls.current?.stop();controls.current=null}
  },[camera,onScan])
  return <ResidentDialog title="Scan visitor pass" eyebrow="IDENTIFY, THEN CONFIRM" onClose={onClose} footerNote="Scanning never records entry or exit. Present a Haruhay pass; government and school ID barcodes are not supported.">
    <div className="visitor-camera"><video ref={video} autoPlay muted playsInline aria-label="QR camera preview" />{!camera&&<button className="admin-primary" onClick={()=>setCamera(true)}>Start camera</button>}</div>
    {error&&<p role="alert" className="admin-error">{error}</p>}
    {scanError&&<p role="alert" className="admin-error">{scanError}</p>}
    <form className="visitor-form" onSubmit={e=>{e.preventDefault();controls.current?.stop();onScan(code.trim())}}><label>Pass code<textarea autoComplete="off" required value={code} onChange={e=>setCode(e.target.value)} placeholder="haruhay:visit:…" maxLength={100}/></label><button className="admin-primary" disabled={busy}>Validate pass</button></form>
  </ResidentDialog>
}
