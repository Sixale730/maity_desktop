/**
 * VoxelDog - Crossy Road style dog character
 * Cute blocky dog with floppy ears, snout, and wagging tail
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelDogProps {
  animate?: boolean;
}

// Dog colors (brown/beige dog)
const COLORS = {
  body: '#8B4513',        // Brown body
  belly: '#D2B48C',       // Tan belly/chest
  snout: '#D2B48C',       // Tan snout
  nose: '#1A1A1A',        // Black nose
  eyes: '#000000',        // Black eyes
  ears: '#654321',        // Darker brown ears
  tongue: '#FF69B4',      // Pink tongue
  paws: '#654321',        // Dark brown paws
};

export function VoxelDog({ animate = false }: VoxelDogProps) {
  const groupRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);

  // Dog animation - tail wag and slight movement
  useFrame((state) => {
    if (animate) {
      const time = state.clock.getElapsedTime();

      if (groupRef.current) {
        // Slight body bounce
        groupRef.current.position.y = Math.sin(time * 2) * 0.02;
      }

      if (tailRef.current) {
        // Tail wagging
        tailRef.current.rotation.z = Math.sin(time * 8) * 0.4;
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* === HEAD === */}
      {/* Main head - large and round */}
      <mesh position={[0, 0.5, 0.3]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.8, 0.8]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Cheeks / Face front - lighter */}
      <mesh position={[0, 0.4, 0.65]} castShadow>
        <boxGeometry args={[0.6, 0.5, 0.15]} />
        <meshStandardMaterial color={COLORS.snout} flatShading roughness={0.8} />
      </mesh>

      {/* === SNOUT === */}
      {/* Snout - tan colored */}
      <mesh position={[0, 0.35, 0.8]} castShadow>
        <boxGeometry args={[0.4, 0.3, 0.25]} />
        <meshStandardMaterial color={COLORS.snout} flatShading roughness={0.8} />
      </mesh>

      {/* Nose - black */}
      <mesh position={[0, 0.4, 0.95]} castShadow>
        <boxGeometry args={[0.18, 0.15, 0.08]} />
        <meshStandardMaterial color={COLORS.nose} flatShading roughness={0.9} />
      </mesh>

      {/* === EYES === */}
      {/* Left eye */}
      <mesh position={[-0.2, 0.6, 0.7]}>
        <boxGeometry args={[0.12, 0.14, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      {/* Right eye */}
      <mesh position={[0.2, 0.6, 0.7]}>
        <boxGeometry args={[0.12, 0.14, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>

      {/* Eye shine (small white dots) */}
      <mesh position={[-0.18, 0.62, 0.72]}>
        <boxGeometry args={[0.04, 0.04, 0.01]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      <mesh position={[0.22, 0.62, 0.72]}>
        <boxGeometry args={[0.04, 0.04, 0.01]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>

      {/* === EARS (Floppy) === */}
      {/* Left ear */}
      <mesh position={[-0.45, 0.7, 0.1]} castShadow>
        <boxGeometry args={[0.2, 0.5, 0.25]} />
        <meshStandardMaterial color={COLORS.ears} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[-0.5, 0.5, 0.1]} castShadow>
        <boxGeometry args={[0.15, 0.25, 0.2]} />
        <meshStandardMaterial color={COLORS.ears} flatShading roughness={0.8} />
      </mesh>

      {/* Right ear */}
      <mesh position={[0.45, 0.7, 0.1]} castShadow>
        <boxGeometry args={[0.2, 0.5, 0.25]} />
        <meshStandardMaterial color={COLORS.ears} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.5, 0.5, 0.1]} castShadow>
        <boxGeometry args={[0.15, 0.25, 0.2]} />
        <meshStandardMaterial color={COLORS.ears} flatShading roughness={0.8} />
      </mesh>

      {/* === TONGUE (optional, panting) === */}
      <mesh position={[0, 0.22, 0.85]} castShadow>
        <boxGeometry args={[0.12, 0.15, 0.08]} />
        <meshStandardMaterial color={COLORS.tongue} flatShading roughness={0.8} />
      </mesh>

      {/* === BODY === */}
      {/* Main body */}
      <mesh position={[0, -0.1, -0.2]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.55, 0.9]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Belly/chest - lighter */}
      <mesh position={[0, -0.15, 0.15]} castShadow>
        <boxGeometry args={[0.5, 0.4, 0.25]} />
        <meshStandardMaterial color={COLORS.belly} flatShading roughness={0.8} />
      </mesh>

      {/* === LEGS === */}
      {/* Front left leg */}
      <mesh position={[-0.25, -0.45, 0.1]} castShadow>
        <boxGeometry args={[0.2, 0.25, 0.2]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[-0.25, -0.6, 0.1]} castShadow>
        <boxGeometry args={[0.18, 0.1, 0.22]} />
        <meshStandardMaterial color={COLORS.paws} flatShading roughness={0.8} />
      </mesh>

      {/* Front right leg */}
      <mesh position={[0.25, -0.45, 0.1]} castShadow>
        <boxGeometry args={[0.2, 0.25, 0.2]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.25, -0.6, 0.1]} castShadow>
        <boxGeometry args={[0.18, 0.1, 0.22]} />
        <meshStandardMaterial color={COLORS.paws} flatShading roughness={0.8} />
      </mesh>

      {/* Back left leg */}
      <mesh position={[-0.25, -0.45, -0.5]} castShadow>
        <boxGeometry args={[0.2, 0.25, 0.2]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[-0.25, -0.6, -0.5]} castShadow>
        <boxGeometry args={[0.18, 0.1, 0.22]} />
        <meshStandardMaterial color={COLORS.paws} flatShading roughness={0.8} />
      </mesh>

      {/* Back right leg */}
      <mesh position={[0.25, -0.45, -0.5]} castShadow>
        <boxGeometry args={[0.2, 0.25, 0.2]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.25, -0.6, -0.5]} castShadow>
        <boxGeometry args={[0.18, 0.1, 0.22]} />
        <meshStandardMaterial color={COLORS.paws} flatShading roughness={0.8} />
      </mesh>

      {/* === TAIL === */}
      <group ref={tailRef} position={[0, 0.05, -0.7]}>
        {/* Tail base */}
        <mesh position={[0, 0.1, 0]} castShadow>
          <boxGeometry args={[0.15, 0.35, 0.15]} />
          <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
        </mesh>
        {/* Tail tip */}
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.12, 0.15, 0.12]} />
          <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
        </mesh>
      </group>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.65, -0.1]} receiveShadow>
        <circleGeometry args={[0.5, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelDog;
