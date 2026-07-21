/**
 * VoxelNinja Character Component
 * Stealthy ninja warrior
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelNinjaProps {
  animate?: boolean;
}

const COLORS = {
  outfit: '#1A1A1A',
  outfitDark: '#0D0D0D',
  outfitLight: '#2D2D2D',
  headband: '#DC2626',
  eyes: '#FFFFFF',
  eyePupil: '#000000',
  skin: '#FFD7C4',
};

export function VoxelNinja({ animate = false }: VoxelNinjaProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      groupRef.current.position.y = Math.sin(time * 3) * 0.025;
      groupRef.current.rotation.y = Math.sin(time * 1.5) * 0.05;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Head wrap */}
      <mesh position={[0, 0.72, 0]} castShadow>
        <boxGeometry args={[0.38, 0.35, 0.32]} />
        <meshStandardMaterial color={COLORS.outfit} flatShading roughness={0.8} />
      </mesh>

      {/* Red headband */}
      <mesh position={[0, 0.78, 0.12]} castShadow>
        <boxGeometry args={[0.4, 0.08, 0.1]} />
        <meshStandardMaterial color={COLORS.headband} flatShading roughness={0.7} />
      </mesh>

      {/* Headband tails (flowing back) */}
      <mesh position={[-0.15, 0.78, -0.2]} rotation={[0.2, 0, -0.3]} castShadow>
        <boxGeometry args={[0.05, 0.04, 0.2]} />
        <meshStandardMaterial color={COLORS.headband} flatShading roughness={0.7} />
      </mesh>
      <mesh position={[0.15, 0.78, -0.2]} rotation={[0.2, 0, 0.3]} castShadow>
        <boxGeometry args={[0.05, 0.04, 0.2]} />
        <meshStandardMaterial color={COLORS.headband} flatShading roughness={0.7} />
      </mesh>

      {/* Eye slit area */}
      <mesh position={[0, 0.72, 0.16]}>
        <boxGeometry args={[0.3, 0.08, 0.02]} />
        <meshStandardMaterial color={COLORS.outfitDark} flatShading roughness={0.8} />
      </mesh>

      {/* Eyes (visible through mask) */}
      <mesh position={[-0.08, 0.72, 0.18]}>
        <boxGeometry args={[0.08, 0.06, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      <mesh position={[0.08, 0.72, 0.18]}>
        <boxGeometry args={[0.08, 0.06, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>

      {/* Pupils */}
      <mesh position={[-0.08, 0.72, 0.2]}>
        <boxGeometry args={[0.03, 0.04, 0.01]} />
        <meshBasicMaterial color={COLORS.eyePupil} />
      </mesh>
      <mesh position={[0.08, 0.72, 0.2]}>
        <boxGeometry args={[0.03, 0.04, 0.01]} />
        <meshBasicMaterial color={COLORS.eyePupil} />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 0.52, 0]} castShadow>
        <boxGeometry args={[0.22, 0.1, 0.18]} />
        <meshStandardMaterial color={COLORS.outfit} flatShading roughness={0.8} />
      </mesh>

      {/* Body (ninja gi) */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.45, 0.55, 0.3]} />
        <meshStandardMaterial color={COLORS.outfit} flatShading roughness={0.8} />
      </mesh>

      {/* Belt */}
      <mesh position={[0, 0.05, 0.1]} castShadow>
        <boxGeometry args={[0.48, 0.08, 0.15]} />
        <meshStandardMaterial color={COLORS.outfitDark} flatShading roughness={0.7} />
      </mesh>

      {/* Arms */}
      <mesh position={[-0.28, 0.25, 0]} castShadow>
        <boxGeometry args={[0.14, 0.4, 0.15]} />
        <meshStandardMaterial color={COLORS.outfit} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.28, 0.25, 0]} castShadow>
        <boxGeometry args={[0.14, 0.4, 0.15]} />
        <meshStandardMaterial color={COLORS.outfit} flatShading roughness={0.8} />
      </mesh>

      {/* Arm wraps */}
      <mesh position={[-0.28, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.08, 0.16]} />
        <meshStandardMaterial color={COLORS.outfitLight} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.28, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.08, 0.16]} />
        <meshStandardMaterial color={COLORS.outfitLight} flatShading roughness={0.8} />
      </mesh>

      {/* Hands */}
      <mesh position={[-0.28, 0.02, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.28, 0.02, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Legs */}
      <mesh position={[-0.12, -0.18, 0]} castShadow>
        <boxGeometry args={[0.15, 0.28, 0.18]} />
        <meshStandardMaterial color={COLORS.outfit} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.12, -0.18, 0]} castShadow>
        <boxGeometry args={[0.15, 0.28, 0.18]} />
        <meshStandardMaterial color={COLORS.outfit} flatShading roughness={0.8} />
      </mesh>

      {/* Leg wraps */}
      <mesh position={[-0.12, -0.25, 0]} castShadow>
        <boxGeometry args={[0.16, 0.06, 0.19]} />
        <meshStandardMaterial color={COLORS.outfitLight} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.12, -0.25, 0]} castShadow>
        <boxGeometry args={[0.16, 0.06, 0.19]} />
        <meshStandardMaterial color={COLORS.outfitLight} flatShading roughness={0.8} />
      </mesh>

      {/* Feet (tabi boots) */}
      <mesh position={[-0.12, -0.35, 0.02]}>
        <boxGeometry args={[0.12, 0.08, 0.18]} />
        <meshStandardMaterial color={COLORS.outfitDark} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.12, -0.35, 0.02]}>
        <boxGeometry args={[0.12, 0.08, 0.18]} />
        <meshStandardMaterial color={COLORS.outfitDark} flatShading roughness={0.8} />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.38, 0]} receiveShadow>
        <circleGeometry args={[0.35, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelNinja;
