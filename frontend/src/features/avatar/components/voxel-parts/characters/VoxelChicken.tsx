/**
 * VoxelChicken - Crossy Road style chicken character
 * The iconic blocky chicken with crest, beak, wings, and orange legs
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelChickenProps {
  animate?: boolean;
}

// Chicken colors
const COLORS = {
  body: '#FFFFFF',        // White body
  crest: '#DC2626',       // Red crest
  wattle: '#DC2626',      // Red wattle (under beak)
  beak: '#F97316',        // Orange beak
  legs: '#F97316',        // Orange legs
  eyes: '#000000',        // Black eyes
  wingTip: '#E5E5E5',     // Slightly darker wing tips
};

export function VoxelChicken({ animate = false }: VoxelChickenProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Chicken bobbing animation
  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      // Pecking motion - head bob
      groupRef.current.position.y = Math.sin(time * 3) * 0.02;
      // Slight rotation like looking around
      groupRef.current.rotation.y = Math.sin(time * 1.5) * 0.1;
    }
  });

  return (
    <group ref={groupRef}>
      {/* === BODY === */}
      {/* Main body - egg/oval shape using multiple boxes */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.8, 1.0]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Body top roundness */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.7, 0.2, 0.8]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* === HEAD === */}
      {/* Head - smaller white block */}
      <mesh position={[0, 0.65, 0.2]} castShadow>
        <boxGeometry args={[0.6, 0.5, 0.5]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* === CREST (Red comb on top) === */}
      {/* Main crest */}
      <mesh position={[0, 0.95, 0.15]} castShadow>
        <boxGeometry args={[0.08, 0.15, 0.3]} />
        <meshStandardMaterial color={COLORS.crest} flatShading roughness={0.8} />
      </mesh>
      {/* Crest bumps */}
      <mesh position={[0, 1.0, 0.25]} castShadow>
        <boxGeometry args={[0.08, 0.08, 0.08]} />
        <meshStandardMaterial color={COLORS.crest} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.02, 0.1]} castShadow>
        <boxGeometry args={[0.08, 0.1, 0.08]} />
        <meshStandardMaterial color={COLORS.crest} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.98, 0.0]} castShadow>
        <boxGeometry args={[0.08, 0.06, 0.08]} />
        <meshStandardMaterial color={COLORS.crest} flatShading roughness={0.8} />
      </mesh>

      {/* === BEAK === */}
      {/* Beak - orange triangle pointing forward */}
      <mesh position={[0, 0.6, 0.5]} castShadow>
        <boxGeometry args={[0.15, 0.1, 0.15]} />
        <meshStandardMaterial color={COLORS.beak} flatShading roughness={0.8} />
      </mesh>
      {/* Beak tip */}
      <mesh position={[0, 0.6, 0.6]} castShadow>
        <boxGeometry args={[0.1, 0.06, 0.1]} />
        <meshStandardMaterial color={COLORS.beak} flatShading roughness={0.8} />
      </mesh>

      {/* === WATTLE (Red thing under beak) === */}
      <mesh position={[0, 0.5, 0.48]} castShadow>
        <boxGeometry args={[0.08, 0.12, 0.06]} />
        <meshStandardMaterial color={COLORS.wattle} flatShading roughness={0.8} />
      </mesh>

      {/* === EYES === */}
      {/* Left eye */}
      <mesh position={[-0.15, 0.7, 0.45]}>
        <boxGeometry args={[0.08, 0.08, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      {/* Right eye */}
      <mesh position={[0.15, 0.7, 0.45]}>
        <boxGeometry args={[0.08, 0.08, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>

      {/* === WINGS === */}
      {/* Left wing */}
      <mesh position={[-0.5, 0.1, 0]} castShadow>
        <boxGeometry args={[0.15, 0.4, 0.5]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[-0.55, 0.0, 0]} castShadow>
        <boxGeometry args={[0.08, 0.25, 0.35]} />
        <meshStandardMaterial color={COLORS.wingTip} flatShading roughness={0.8} />
      </mesh>

      {/* Right wing */}
      <mesh position={[0.5, 0.1, 0]} castShadow>
        <boxGeometry args={[0.15, 0.4, 0.5]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.55, 0.0, 0]} castShadow>
        <boxGeometry args={[0.08, 0.25, 0.35]} />
        <meshStandardMaterial color={COLORS.wingTip} flatShading roughness={0.8} />
      </mesh>

      {/* === TAIL === */}
      {/* Tail feathers */}
      <mesh position={[0, 0.2, -0.55]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.15]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.35, -0.6]} castShadow>
        <boxGeometry args={[0.2, 0.2, 0.1]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* === LEGS === */}
      {/* Left leg */}
      <mesh position={[-0.2, -0.5, 0.1]} castShadow>
        <boxGeometry args={[0.1, 0.25, 0.1]} />
        <meshStandardMaterial color={COLORS.legs} flatShading roughness={0.8} />
      </mesh>
      {/* Left foot */}
      <mesh position={[-0.2, -0.65, 0.15]} castShadow>
        <boxGeometry args={[0.15, 0.05, 0.2]} />
        <meshStandardMaterial color={COLORS.legs} flatShading roughness={0.8} />
      </mesh>

      {/* Right leg */}
      <mesh position={[0.2, -0.5, 0.1]} castShadow>
        <boxGeometry args={[0.1, 0.25, 0.1]} />
        <meshStandardMaterial color={COLORS.legs} flatShading roughness={0.8} />
      </mesh>
      {/* Right foot */}
      <mesh position={[0.2, -0.65, 0.15]} castShadow>
        <boxGeometry args={[0.15, 0.05, 0.2]} />
        <meshStandardMaterial color={COLORS.legs} flatShading roughness={0.8} />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.68, 0.1]} receiveShadow>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelChicken;
