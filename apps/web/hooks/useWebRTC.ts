'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

type Signal = { from: string; type: 'offer'|'answer'|'ice-candidate'|'hangup'; payload?: any };
export function useWebRTC(socket: Socket|null) {
  const peer = useRef<RTCPeerConnection|null>(null);
  const localStream = useRef<MediaStream|null>(null);
  const remoteStream = useRef<MediaStream|null>(null);
  const currentPeer = useRef<string|null>(null);
  const displayStream = useRef<MediaStream|null>(null);
  const bitrateTimer = useRef<ReturnType<typeof setInterval>|null>(null);
  const pendingOffer = useRef<RTCSessionDescriptionInit|null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const pendingVideo = useRef(true);
  const [local, setLocal] = useState<MediaStream|null>(null);
  const [remote, setRemote] = useState<MediaStream|null>(null);
  const [incomingFrom, setIncomingFrom] = useState<string|null>(null);
  const [status, setStatus] = useState<'idle'|'calling'|'ringing'|'connecting'|'connected'>('idle');
  const [screenSharing,setScreenSharing]=useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const closePeer = useCallback(() => { if(bitrateTimer.current) clearInterval(bitrateTimer.current); bitrateTimer.current=null; peer.current?.close(); peer.current = null; displayStream.current?.getTracks().forEach(t=>t.stop()); displayStream.current=null; setScreenSharing(false); localStream.current?.getTracks().forEach(t => t.stop()); localStream.current = null; remoteStream.current = null; setLocal(null); setRemote(null); currentPeer.current = null; setIncomingFrom(null); setStatus('idle'); }, []);
  const makePeer = useCallback((to: string) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peer.current = pc;
    pc.onicecandidate = e => { if (e.candidate) socket?.emit('call:signal', { to, type: 'ice-candidate', payload: e.candidate.toJSON() }); };
    pc.ontrack = e => { const stream = e.streams[0]; remoteStream.current = stream; setRemote(stream); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') setStatus('connected'); if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setStatus('connecting'); };
    bitrateTimer.current=setInterval(()=>{void (async()=>{const stats=await pc.getStats();let available=0;stats.forEach(report=>{if(report.type==='candidate-pair'&&report.state==='succeeded'&&typeof report.availableOutgoingBitrate==='number')available=report.availableOutgoingBitrate});const sender=pc.getSenders().find(item=>item.track?.kind==='video');if(!sender||!available)return;const parameters=sender.getParameters();parameters.encodings??=[{}];parameters.encodings[0].maxBitrate=Math.max(150_000,Math.min(2_500_000,Math.floor(available*.72)));await sender.setParameters(parameters).catch(()=>undefined)})().catch(()=>undefined)},2500);
    return pc;
  }, [socket]);
  const startCall = useCallback(async (to: string, video = false) => {
    if (!socket) throw new Error('Signaling is not connected');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video }); localStream.current = stream; setLocal(stream); currentPeer.current = to;
    const pc = makePeer(to); stream.getTracks().forEach(track => pc.addTrack(track, stream));
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer); setStatus('calling');
    socket.emit('call:signal', { to, type: 'offer', payload: { sdp: pc.localDescription?.toJSON(), video } });
  }, [makePeer, socket]);
  const acceptCall = useCallback(async () => {
    if (!socket || !incomingFrom) return;
    const from = incomingFrom; const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: pendingVideo.current }); localStream.current = stream; setLocal(stream);
    const pc = makePeer(from); stream.getTracks().forEach(track => pc.addTrack(track, stream));
    if (!pendingOffer.current) return;
    await pc.setRemoteDescription(pendingOffer.current); pendingOffer.current = null; for (const candidate of pendingCandidates.current.splice(0)) await pc.addIceCandidate(candidate); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
    socket.emit('call:signal', { to: from, type: 'answer', payload: { sdp: pc.localDescription?.toJSON() } }); setIncomingFrom(null); setStatus('connecting');
  }, [incomingFrom, makePeer, socket]);
  const endCall = useCallback(() => { if (currentPeer.current) socket?.emit('call:signal', { to: currentPeer.current, type: 'hangup' }); closePeer(); }, [closePeer, socket]);
  const toggleTrack = useCallback((kind: 'audio'|'video') => { const track = localStream.current?.getTracks().find(t => t.kind === kind); if (track) track.enabled = !track.enabled; return track?.enabled ?? false; }, []);
  const flipCamera = useCallback(async()=>{const current=localStream.current?.getVideoTracks()[0];if(!current||!peer.current) return false;const facing=current.getSettings().facingMode==='environment'?'user':'environment';const nextStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing}}});const next=nextStream.getVideoTracks()[0];const sender=peer.current.getSenders().find(item=>item.track?.kind==='video');if(!sender){next.stop();return false}await sender.replaceTrack(next);current.stop();localStream.current=new MediaStream([...localStream.current!.getAudioTracks(),next]);setLocal(localStream.current);return true},[]);
  const shareScreen = useCallback(async()=>{const sender=peer.current?.getSenders().find(item=>item.track?.kind==='video');if(!sender)return false;if(displayStream.current){displayStream.current.getTracks().forEach(track=>track.stop());displayStream.current=null;const camera=localStream.current?.getVideoTracks()[0];if(camera)await sender.replaceTrack(camera);setScreenSharing(false);return false}const screen=await navigator.mediaDevices.getDisplayMedia({video:true});const track=screen.getVideoTracks()[0];displayStream.current=screen;await sender.replaceTrack(track);setScreenSharing(true);track.onended=()=>{const camera=localStream.current?.getVideoTracks()[0];if(camera)void sender.replaceTrack(camera);displayStream.current=null;setScreenSharing(false)};return true},[]);
  useEffect(() => {
    if (!socket) return;
    const onSignal = async (s: Signal) => {
      try {
        if (s.type === 'offer') { closePeer(); makePeer(s.from); currentPeer.current = s.from; pendingOffer.current = s.payload.sdp; pendingVideo.current = Boolean(s.payload.video); setIncomingFrom(s.from); setStatus('ringing'); }
        else if (s.type === 'answer' && peer.current) { await peer.current.setRemoteDescription(s.payload.sdp); setStatus('connecting'); }
        else if (s.type === 'ice-candidate' && s.payload) { if(peer.current?.remoteDescription) await peer.current.addIceCandidate(s.payload); else pendingCandidates.current.push(s.payload); }
        else if (s.type === 'hangup') closePeer();
      } catch (e) { console.error('WebRTC signaling failed', e); closePeer(); }
    };
    socket.on('call:signal', onSignal); return () => { socket.off('call:signal', onSignal); };
  }, [closePeer, makePeer, socket]);
  useEffect(() => () => { peer.current?.close(); localStream.current?.getTracks().forEach(t => t.stop()); }, []);
  useEffect(() => {
    const tracks = remote?.getAudioTracks() ?? [];
    if (!tracks.length) { setAudioLevel(0); return; }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 128;
    const source = context.createMediaStreamSource(new MediaStream(tracks));
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const sample = () => {
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const value of samples) { const amplitude = (value - 128) / 128; energy += amplitude * amplitude; }
      setAudioLevel(Math.min(1, Math.sqrt(energy / samples.length) * 3.5));
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => { cancelAnimationFrame(frame); source.disconnect(); void context.close(); setAudioLevel(0); };
  }, [remote]);
  return { local, remote, status, incomingFrom, startCall, acceptCall, endCall, toggleTrack, flipCamera, shareScreen, screenSharing, audioLevel };
}
