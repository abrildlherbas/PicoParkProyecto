import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
} from 'react-native';
import { io } from 'socket.io-client';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';

ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);

export default function App() {
  useKeepAwake(); // Wake Lock: la pantalla no se apaga

  const [ip, setIp] = useState('');
  const [connected, setConnected] = useState(false);
  const [color, setColor] = useState('#888');
  const socketRef = useRef(null);

  const connect = () => {
    if (socketRef.current) socketRef.current.disconnect();

    const socket = io(`http://${ip}`, {
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('connect', () => {
    setConnected(true);
    socket.emit('join');
      });
    socket.on('disconnect', () => setConnected(false));
    socket.on('welcome', (data) => setColor(data.color));
    socket.on('error_msg', (msg) => alert(msg));

    socketRef.current = socket;
  };

  const send = (type, key) => {
    socketRef.current?.emit(type, key);
  };

  // Botón que envía keydown al presionar y keyup al soltar
  const Btn = ({ label, keyName, style }) => (
    <TouchableOpacity
      activeOpacity={0.6}
      style={[styles.btn, style]}
      onPressIn={() => send('keydown', keyName)}
      onPressOut={() => send('keyup', keyName)}
    >
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );

  // Pantalla de conexión
  if (!connected) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Pico Gamepad</Text>
        <TextInput
          style={styles.input}
          placeholder="192.168.1.15:3000"
          placeholderTextColor="#888"
          value={ip}
          onChangeText={setIp}
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.connectBtn} onPress={connect}>
          <Text style={styles.btnText}>Conectar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Pantalla del gamepad
  return (
    <View style={[styles.pad, { borderColor: color }]}>
      <View style={[styles.led, { backgroundColor: '#2ecc71' }]} />

      <View style={styles.dpad}>
        <Btn label="◀" keyName="left" />
        <Btn label="▶" keyName="right" />
      </View>

      <Btn label="A" keyName="jump" style={styles.btnA} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 28, marginBottom: 20 },
  input: { backgroundColor: '#222', color: '#fff', width: 260, padding: 12, borderRadius: 8, marginBottom: 12 },
  connectBtn: { backgroundColor: '#3498db', padding: 14, borderRadius: 8, width: 260, alignItems: 'center' },
  pad: { flex: 1, backgroundColor: '#111', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 40, borderWidth: 6 },
  led: { position: 'absolute', top: 12, left: 12, width: 14, height: 14, borderRadius: 7 },
  dpad: { flexDirection: 'row', gap: 16 },
  btn: { backgroundColor: '#333', width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  btnA: { backgroundColor: '#e74c3c', width: 130, height: 130, borderRadius: 65 },
  btnText: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
});