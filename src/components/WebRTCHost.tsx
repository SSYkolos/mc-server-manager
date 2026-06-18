import React, { useEffect, useRef, useState } from 'react';
import Peer from 'simple-peer';
import { collection, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase'; // Adjust path if needed

interface WebRTCHostProps {
  serverId: string;
  serverRunning: boolean;
}

export default function WebRTCHost({ serverId, serverRunning }: WebRTCHostProps) {
  // We store all active remote admin connections in a Ref
  // This maps ViewerUserID -> Peer Instance (Perfect for your future "Kick" dashboard)
  const peersRef = useRef<Record<string, Peer.Instance>>({});
  const [activeAdminCount, setActiveAdminCount] = useState(0);

  useEffect(() => {
    if (!serverRunning) {
      // Clean up all connections if the server stops
      Object.values(peersRef.current).forEach(peer => peer.destroy());
      peersRef.current = {};
      setActiveAdminCount(0);
      return;
    }

    const signalsRef = collection(db, 'servers', serverId, 'console-signals');

    // 1. Listen for new Admin Offers in the Firestore subcollection
    const unsubscribeSignals = onSnapshot(signalsRef, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const viewerId = change.doc.id;
          const data = change.doc.data();

          // If we got an offer and haven't created a peer for them yet
          if (data.offer && !data.answer && !peersRef.current[viewerId]) {
            console.log(`[WebRTC Host] Connecting to remote admin: ${viewerId}`);

            const peer = new Peer({ initiator: false, trickle: false });

            // Feed the admin's offer to our peer
            peer.signal(data.offer);

            // When our peer generates an answer, write it to Firestore
            peer.on('signal', async (answer) => {
              await updateDoc(doc(db, 'servers', serverId, 'console-signals', viewerId), {
                answer: answer
              });
            });

            // When connected, update our UI state
            peer.on('connect', () => {
              console.log(`[WebRTC Host] P2P Connected with ${viewerId}!`);
              setActiveAdminCount(Object.keys(peersRef.current).length);
              peer.send(JSON.stringify({ type: 'system', text: '\n--- Connected to Host Console ---\n' }));
            });

            // Listen for commands from the remote admin
            peer.on('data', async (raw) => {
              const message = JSON.parse(raw.toString());
              if (message.type === 'command') {
                console.log(`[WebRTC Host] Received remote command: ${message.command}`);
                // Execute the command locally!
                await window.electronAPI.sendServerCommand({ serverId, command: message.command });
              }
            });

            // Handle disconnection
            peer.on('close', () => {
              console.log(`[WebRTC Host] Disconnected from ${viewerId}`);
              delete peersRef.current[viewerId];
              setActiveAdminCount(Object.keys(peersRef.current).length);
            });

            // Save the peer to our map
            peersRef.current[viewerId] = peer;
          }
        }
      });
    });

    // 2. Hook into your local IPC logs to broadcast them to all connected admins
    const unsubscribeLogs = window.electronAPI.onServerLog((data) => {
      if (data.serverId !== serverId) return;

      const logMessage = JSON.stringify({ type: 'log', text: data.log });
      
      // Send this exact log line to every connected remote admin instantly
      Object.values(peersRef.current).forEach((peer) => {
        if (peer.connected) {
          peer.send(logMessage);
        }
      });
    });

    return () => {
      unsubscribeSignals();
      unsubscribeLogs();
    };
  }, [serverId, serverRunning]);

  if (!serverRunning) return null;

  return (
    <div style={{ padding: '0 8px', fontSize: '12px', color: '#00ff66', opacity: 0.8 }}>
      📡 P2P Broadcaster Active (Remote Admins: {activeAdminCount})
    </div>
  );
}