/**
 * VoxelKnight - Knight character with sword and shield
 * Blue armor with silver helmet in voxel style
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelKnightProps {
  animate?: boolean;
}

// Knight colors
const COLORS = {
  armor: '#4A90D9',      // Blue armor
  helmet: '#C0C0C0',     // Silver helmet
  visor: '#1A1A2E',      // Dark visor
  sword: '#C0C0C0',      // Silver sword
  handle: '#8B4513',     // Brown handle
  shield: '#DC2626',     // Red shield
};

export function VoxelKnight({ animate = false }: VoxelKnightProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      // Knight bobbing
      groupRef.current.position.y = Math.sin(time * 2) * 0.02;
      // Slight rotation
      groupRef.current.rotation.y = Math.sin(time * 1.5) * 0.08;
    }
  });

  return (
    <group ref={groupRef}>
      {/* === HEAD/HELMET === */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <boxGeometry args={[0.35, 0.35, 0.3]} />
        <meshStandardMaterial color={COLORS.helmet} flatShading roughness={0.4} metalness={0.3} />
      </mesh>

      {/* Helmet visor */}
      <mesh position={[0, 0.75, 0.16]} castShadow>
        <boxGeometry args={[0.25, 0.1, 0.02]} />
        <meshStandardMaterial color={COLORS.visor} flatShading />
      </mesh>

      {/* Helmet plume */}
      <mesh position={[0, 1.0, -0.05]} castShadow>
        <boxGeometry args={[0.08, 0.12, 0.2]} />
        <meshStandardMaterial color={COLORS.shield} flatShading />
      </mesh>

      {/* === BODY === */}
      <mesh position={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[0.4, 0.5, 0.3]} />
        <meshStandardMaterial color={COLORS.armor} flatShading roughness={0.5} />
      </mesh>

      {/* Chest plate detail */}
      <mesh position={[0, 0.45, 0.16]} castShadow>
        <boxGeometry args={[0.25, 0.2, 0.02]} />
        <meshStandardMaterial color={COLORS.helmet} flatShading roughness={0.4} metalness={0.3} />
      </mesh>

      {/* === ARMS === */}
      {/* Left arm (shield arm) */}
      <mesh position={[-0.28, 0.4, 0]} castShadow>
        <boxGeometry args={[0.12, 0.35, 0.15]} />
        <meshStandardMaterial color={COLORS.armor} flatShading />
      </mesh>

      {/* Right arm (sword arm) */}
      <mesh position={[0.28, 0.4, 0]} castShadow>
        <boxGeometry args={[0.12, 0.35, 0.15]} />
        <meshStandardMaterial color={COLORS.armor} flatShading />
      </mesh>

      {/* === SWORD === */}
      <mesh position={[0.35, 0.3, 0]} castShadow>
        <boxGeometry args={[0.08, 0.6, 0.04]} />
        <meshStandardMaterial color={COLORS.sword} flatShading metalness={0.5} roughness={0.3} />
      </mesh>

      {/* Sword handle */}
      <mesh position={[0.35, 0.05, 0]} castShadow>
        <boxGeometry args={[0.15, 0.1, 0.06]} />
        <meshStandardMaterial color={COLORS.handle} flatShading />
      </mesh>

      {/* Sword guard */}
      <mesh position={[0.35, 0.12, 0]} castShadow>
        <boxGeometry args={[0.04, 0.04, 0.12]} />
        <meshStandardMaterial color={COLORS.helmet} flatShading metalness={0.5} />
      </mesh>

      {/* === SHIELD === */}
      <mesh position={[-0.35, 0.35, 0.05]} castShadow>
        <boxGeometry args={[0.08, 0.4, 0.3]} />
        <meshStandardMaterial color={COLORS.shield} flatShading />
      </mesh>

      {/* Shield emblem */}
      <mesh position={[-0.36, 0.35, 0.18]} castShadow>
        <boxGeometry args={[0.02, 0.15, 0.1]} />
        <meshStandardMaterial color={COLORS.helmet} flatShading metalness={0.3} />
      </mesh>

      {/* === LEGS === */}
      <mesh position={[-0.1, 0.08, 0]} castShadow>
        <boxGeometry args={[0.12, 0.25, 0.15]} />
        <meshStandardMaterial color={COLORS.armor} flatShading />
      </mesh>
      <mesh position={[0.1, 0.08, 0]} castShadow>
        <boxGeometry args={[0.12, 0.25, 0.15]} />
        <meshStandardMaterial color={COLORS.armor} flatShading />
      </mesh>

      {/* === FEET === */}
      <mesh position={[-0.1, -0.08, 0.02]} castShadow>
        <boxGeometry args={[0.14, 0.08, 0.18]} />
        <meshStandardMaterial color={COLORS.helmet} flatShading roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0.1, -0.08, 0.02]} castShadow>
        <boxGeometry args={[0.14, 0.08, 0.18]} />
        <meshStandardMaterial color={COLORS.helmet} flatShading roughness={0.4} metalness={0.3} />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]} receiveShadow>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelKnight;
