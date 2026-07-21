/**
 * VoxelLionKnight - Crossy Road style lion knight character
 * A noble lion in medieval armor with helmet and red plume
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelLionKnightProps {
  animate?: boolean;
}

// Lion Knight colors
const COLORS = {
  body: '#EDB221',      // Golden/Yellow lion body
  mane: '#8B4513',      // Brown mane
  armor: '#D3D3D3',     // Metallic gray armor
  armorGold: '#FFD700', // Gold details on armor
  plume: '#FF0000',     // Red helmet plume
  eyes: '#000000',      // Black eyes
  snout: '#D4A84B',     // Lighter snout
};

export function VoxelLionKnight({ animate = false }: VoxelLionKnightProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Breathing animation
  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      // Gentle breathing
      groupRef.current.position.y = Math.sin(time * 2) * 0.03;
      // Slight noble sway
      groupRef.current.rotation.y = Math.sin(time * 1.2) * 0.05;
    }
  });

  return (
    <group ref={groupRef}>
      {/* === HEAD === */}
      {/* Main head - golden block */}
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.75, 0.7, 0.65]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Snout - slightly lighter */}
      <mesh position={[0, 0.65, 0.35]} castShadow>
        <boxGeometry args={[0.4, 0.35, 0.25]} />
        <meshStandardMaterial color={COLORS.snout} flatShading roughness={0.8} />
      </mesh>

      {/* Nose */}
      <mesh position={[0, 0.72, 0.48]}>
        <boxGeometry args={[0.12, 0.1, 0.05]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.18, 0.82, 0.32]}>
        <boxGeometry args={[0.1, 0.1, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      <mesh position={[0.18, 0.82, 0.32]}>
        <boxGeometry args={[0.1, 0.1, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>

      {/* === MANE === */}
      {/* Mane surrounds the head - fluffy brown fur */}
      {/* Top mane */}
      <mesh position={[0, 1.0, -0.1]} castShadow>
        <boxGeometry args={[0.9, 0.25, 0.5]} />
        <meshStandardMaterial color={COLORS.mane} flatShading roughness={0.9} />
      </mesh>
      {/* Left mane */}
      <mesh position={[-0.45, 0.75, -0.05]} castShadow>
        <boxGeometry args={[0.2, 0.6, 0.55]} />
        <meshStandardMaterial color={COLORS.mane} flatShading roughness={0.9} />
      </mesh>
      {/* Right mane */}
      <mesh position={[0.45, 0.75, -0.05]} castShadow>
        <boxGeometry args={[0.2, 0.6, 0.55]} />
        <meshStandardMaterial color={COLORS.mane} flatShading roughness={0.9} />
      </mesh>
      {/* Bottom mane (chin) */}
      <mesh position={[0, 0.45, 0.1]} castShadow>
        <boxGeometry args={[0.5, 0.15, 0.35]} />
        <meshStandardMaterial color={COLORS.mane} flatShading roughness={0.9} />
      </mesh>
      {/* Back mane */}
      <mesh position={[0, 0.7, -0.35]} castShadow>
        <boxGeometry args={[0.7, 0.5, 0.2]} />
        <meshStandardMaterial color={COLORS.mane} flatShading roughness={0.9} />
      </mesh>

      {/* === HELMET === */}
      {/* Helmet base - sits on top of head */}
      <mesh position={[0, 1.15, 0.05]} castShadow>
        <boxGeometry args={[0.65, 0.2, 0.55]} />
        <meshStandardMaterial color={COLORS.armor} flatShading roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Helmet top */}
      <mesh position={[0, 1.28, 0]} castShadow>
        <boxGeometry args={[0.45, 0.12, 0.4]} />
        <meshStandardMaterial color={COLORS.armor} flatShading roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Gold trim on helmet */}
      <mesh position={[0, 1.15, 0.3]} castShadow>
        <boxGeometry args={[0.55, 0.08, 0.05]} />
        <meshStandardMaterial color={COLORS.armorGold} flatShading roughness={0.3} metalness={0.5} />
      </mesh>

      {/* Red Plume */}
      <mesh position={[0, 1.45, -0.1]} castShadow>
        <boxGeometry args={[0.1, 0.25, 0.3]} />
        <meshStandardMaterial color={COLORS.plume} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.55, -0.15]} castShadow>
        <boxGeometry args={[0.08, 0.15, 0.2]} />
        <meshStandardMaterial color={COLORS.plume} flatShading roughness={0.8} />
      </mesh>

      {/* === ARMOR (CHEST) === */}
      {/* Main chestplate */}
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.85, 0.6, 0.55]} />
        <meshStandardMaterial color={COLORS.armor} flatShading roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Gold emblem on chest */}
      <mesh position={[0, 0.15, 0.28]}>
        <boxGeometry args={[0.25, 0.25, 0.02]} />
        <meshStandardMaterial color={COLORS.armorGold} flatShading roughness={0.3} metalness={0.5} />
      </mesh>

      {/* === SHOULDER PADS === */}
      {/* Left shoulder */}
      <mesh position={[-0.55, 0.25, 0]} castShadow>
        <boxGeometry args={[0.3, 0.25, 0.35]} />
        <meshStandardMaterial color={COLORS.armor} flatShading roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[-0.55, 0.35, 0]}>
        <boxGeometry args={[0.22, 0.08, 0.25]} />
        <meshStandardMaterial color={COLORS.armorGold} flatShading roughness={0.3} metalness={0.5} />
      </mesh>

      {/* Right shoulder */}
      <mesh position={[0.55, 0.25, 0]} castShadow>
        <boxGeometry args={[0.3, 0.25, 0.35]} />
        <meshStandardMaterial color={COLORS.armor} flatShading roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0.55, 0.35, 0]}>
        <boxGeometry args={[0.22, 0.08, 0.25]} />
        <meshStandardMaterial color={COLORS.armorGold} flatShading roughness={0.3} metalness={0.5} />
      </mesh>

      {/* === LEGS === */}
      {/* Left leg */}
      <mesh position={[-0.25, -0.35, 0]} castShadow>
        <boxGeometry args={[0.25, 0.35, 0.25]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      {/* Left foot */}
      <mesh position={[-0.25, -0.55, 0.08]} castShadow>
        <boxGeometry args={[0.22, 0.12, 0.3]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Right leg */}
      <mesh position={[0.25, -0.35, 0]} castShadow>
        <boxGeometry args={[0.25, 0.35, 0.25]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      {/* Right foot */}
      <mesh position={[0.25, -0.55, 0.08]} castShadow>
        <boxGeometry args={[0.22, 0.12, 0.3]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.62, 0.05]} receiveShadow>
        <circleGeometry args={[0.5, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelLionKnight;
