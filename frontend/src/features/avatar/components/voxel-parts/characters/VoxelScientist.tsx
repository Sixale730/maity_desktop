/**
 * VoxelScientist Character Component
 * Mad scientist with lab coat and glasses
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelScientistProps {
  animate?: boolean;
}

const COLORS = {
  labCoat: '#FFFFFF',
  labCoatLight: '#F5F5F5',
  shirt: '#3B82F6',
  tie: '#DC2626',
  pants: '#374151',
  skin: '#FFD7C4',
  hair: '#6B7280',
  hairLight: '#9CA3AF',
  eyes: '#000000',
  glasses: '#1A1A1A',
  glassesLens: '#E0F2FE',
};

export function VoxelScientist({ animate = false }: VoxelScientistProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      groupRef.current.position.y = Math.sin(time * 2.5) * 0.03;
      groupRef.current.rotation.y = Math.sin(time * 1.3) * 0.06;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Messy hair */}
      <mesh position={[0, 0.92, -0.02]} castShadow>
        <boxGeometry args={[0.4, 0.18, 0.35]} />
        <meshStandardMaterial color={COLORS.hair} flatShading roughness={0.9} />
      </mesh>

      {/* Hair tufts (messy look) */}
      <mesh position={[-0.15, 1.0, 0.05]} rotation={[0, 0, -0.3]} castShadow>
        <boxGeometry args={[0.08, 0.12, 0.08]} />
        <meshStandardMaterial color={COLORS.hairLight} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0.12, 1.02, 0]} rotation={[0, 0, 0.4]} castShadow>
        <boxGeometry args={[0.08, 0.14, 0.08]} />
        <meshStandardMaterial color={COLORS.hair} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.0, -0.1]} rotation={[0.3, 0, 0]} castShadow>
        <boxGeometry args={[0.1, 0.1, 0.08]} />
        <meshStandardMaterial color={COLORS.hairLight} flatShading roughness={0.9} />
      </mesh>

      {/* Face */}
      <mesh position={[0, 0.68, 0.08]} castShadow>
        <boxGeometry args={[0.38, 0.35, 0.3]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Glasses frame */}
      <mesh position={[0, 0.72, 0.24]}>
        <boxGeometry args={[0.35, 0.03, 0.03]} />
        <meshStandardMaterial color={COLORS.glasses} flatShading roughness={0.6} />
      </mesh>

      {/* Left lens */}
      <mesh position={[-0.1, 0.72, 0.24]}>
        <boxGeometry args={[0.12, 0.1, 0.02]} />
        <meshStandardMaterial color={COLORS.glasses} flatShading roughness={0.6} />
      </mesh>
      <mesh position={[-0.1, 0.72, 0.26]}>
        <boxGeometry args={[0.1, 0.08, 0.01]} />
        <meshStandardMaterial
          color={COLORS.glassesLens}
          flatShading
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Right lens */}
      <mesh position={[0.1, 0.72, 0.24]}>
        <boxGeometry args={[0.12, 0.1, 0.02]} />
        <meshStandardMaterial color={COLORS.glasses} flatShading roughness={0.6} />
      </mesh>
      <mesh position={[0.1, 0.72, 0.26]}>
        <boxGeometry args={[0.1, 0.08, 0.01]} />
        <meshStandardMaterial
          color={COLORS.glassesLens}
          flatShading
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Eyes behind glasses */}
      <mesh position={[-0.1, 0.72, 0.22]}>
        <boxGeometry args={[0.05, 0.05, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      <mesh position={[0.1, 0.72, 0.22]}>
        <boxGeometry args={[0.05, 0.05, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>

      {/* Eyebrows */}
      <mesh position={[-0.1, 0.8, 0.22]}>
        <boxGeometry args={[0.1, 0.025, 0.02]} />
        <meshStandardMaterial color={COLORS.hair} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0.1, 0.8, 0.22]}>
        <boxGeometry args={[0.1, 0.025, 0.02]} />
        <meshStandardMaterial color={COLORS.hair} flatShading roughness={0.9} />
      </mesh>

      {/* Nose */}
      <mesh position={[0, 0.64, 0.24]}>
        <boxGeometry args={[0.06, 0.1, 0.05]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Mouth */}
      <mesh position={[0, 0.54, 0.22]}>
        <boxGeometry args={[0.1, 0.03, 0.02]} />
        <meshStandardMaterial color="#C4A484" flatShading roughness={0.8} />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 0.45, 0.05]} castShadow>
        <boxGeometry args={[0.2, 0.1, 0.15]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Lab coat body */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.5, 0.6, 0.32]} />
        <meshStandardMaterial color={COLORS.labCoat} flatShading roughness={0.9} />
      </mesh>

      {/* Shirt (visible through open coat) */}
      <mesh position={[0, 0.25, 0.15]} castShadow>
        <boxGeometry args={[0.2, 0.3, 0.05]} />
        <meshStandardMaterial color={COLORS.shirt} flatShading roughness={0.8} />
      </mesh>

      {/* Tie */}
      <mesh position={[0, 0.2, 0.18]}>
        <boxGeometry args={[0.06, 0.25, 0.02]} />
        <meshStandardMaterial color={COLORS.tie} flatShading roughness={0.7} />
      </mesh>

      {/* Coat lapels */}
      <mesh position={[-0.12, 0.28, 0.16]} rotation={[0, 0, 0.2]} castShadow>
        <boxGeometry args={[0.12, 0.3, 0.03]} />
        <meshStandardMaterial color={COLORS.labCoatLight} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0.12, 0.28, 0.16]} rotation={[0, 0, -0.2]} castShadow>
        <boxGeometry args={[0.12, 0.3, 0.03]} />
        <meshStandardMaterial color={COLORS.labCoatLight} flatShading roughness={0.9} />
      </mesh>

      {/* Pocket */}
      <mesh position={[-0.15, 0.15, 0.17]}>
        <boxGeometry args={[0.1, 0.08, 0.02]} />
        <meshStandardMaterial color={COLORS.labCoatLight} flatShading roughness={0.9} />
      </mesh>

      {/* Pen in pocket */}
      <mesh position={[-0.12, 0.18, 0.18]}>
        <boxGeometry args={[0.015, 0.08, 0.015]} />
        <meshStandardMaterial color="#1A1A1A" flatShading roughness={0.6} />
      </mesh>

      {/* Arms */}
      <mesh position={[-0.32, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.45, 0.18]} />
        <meshStandardMaterial color={COLORS.labCoat} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0.32, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.45, 0.18]} />
        <meshStandardMaterial color={COLORS.labCoat} flatShading roughness={0.9} />
      </mesh>

      {/* Hands */}
      <mesh position={[-0.32, -0.1, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.32, -0.1, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Pants */}
      <mesh position={[-0.12, -0.22, 0]} castShadow>
        <boxGeometry args={[0.15, 0.25, 0.18]} />
        <meshStandardMaterial color={COLORS.pants} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.12, -0.22, 0]} castShadow>
        <boxGeometry args={[0.15, 0.25, 0.18]} />
        <meshStandardMaterial color={COLORS.pants} flatShading roughness={0.8} />
      </mesh>

      {/* Shoes */}
      <mesh position={[-0.12, -0.38, 0.02]}>
        <boxGeometry args={[0.12, 0.08, 0.18]} />
        <meshStandardMaterial color="#1A1A1A" flatShading roughness={0.7} />
      </mesh>
      <mesh position={[0.12, -0.38, 0.02]}>
        <boxGeometry args={[0.12, 0.08, 0.18]} />
        <meshStandardMaterial color="#1A1A1A" flatShading roughness={0.7} />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.41, 0]} receiveShadow>
        <circleGeometry args={[0.35, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelScientist;
