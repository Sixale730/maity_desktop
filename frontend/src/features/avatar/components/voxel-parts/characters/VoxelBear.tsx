/**
 * VoxelBear Character Component
 * Brown forest bear
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelBearProps {
  animate?: boolean;
}

const COLORS = {
  body: '#8B4513',
  bodyLight: '#A0522D',
  muzzle: '#D2691E',
  nose: '#000000',
  eyes: '#000000',
  innerEar: '#CD853F',
};

export function VoxelBear({ animate = false }: VoxelBearProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      groupRef.current.position.y = Math.sin(time * 2) * 0.03;
      groupRef.current.rotation.y = Math.sin(time * 1.2) * 0.06;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Head */}
      <mesh position={[0, 0.58, 0.05]} castShadow>
        <boxGeometry args={[0.5, 0.45, 0.4]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Ears */}
      <mesh position={[-0.2, 0.85, 0]} castShadow>
        <boxGeometry args={[0.12, 0.12, 0.1]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.2, 0.85, 0]} castShadow>
        <boxGeometry args={[0.12, 0.12, 0.1]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Inner ears */}
      <mesh position={[-0.2, 0.85, 0.05]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshStandardMaterial color={COLORS.innerEar} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.2, 0.85, 0.05]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshStandardMaterial color={COLORS.innerEar} flatShading roughness={0.8} />
      </mesh>

      {/* Muzzle */}
      <mesh position={[0, 0.5, 0.2]} castShadow>
        <boxGeometry args={[0.22, 0.18, 0.18]} />
        <meshStandardMaterial color={COLORS.muzzle} flatShading roughness={0.8} />
      </mesh>

      {/* Nose */}
      <mesh position={[0, 0.54, 0.3]}>
        <boxGeometry args={[0.1, 0.06, 0.04]} />
        <meshStandardMaterial color={COLORS.nose} flatShading roughness={0.6} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.12, 0.62, 0.24]}>
        <boxGeometry args={[0.08, 0.08, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      <mesh position={[0.12, 0.62, 0.24]}>
        <boxGeometry args={[0.08, 0.08, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>

      {/* Eye highlights */}
      <mesh position={[-0.1, 0.64, 0.26]}>
        <boxGeometry args={[0.02, 0.02, 0.01]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      <mesh position={[0.14, 0.64, 0.26]}>
        <boxGeometry args={[0.02, 0.02, 0.01]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>

      {/* Body */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.55, 0.5, 0.45]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Belly */}
      <mesh position={[0, 0.1, 0.18]} castShadow>
        <boxGeometry args={[0.35, 0.35, 0.12]} />
        <meshStandardMaterial color={COLORS.bodyLight} flatShading roughness={0.8} />
      </mesh>

      {/* Arms */}
      <mesh position={[-0.32, 0.12, 0]} castShadow>
        <boxGeometry args={[0.15, 0.38, 0.18]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.32, 0.12, 0]} castShadow>
        <boxGeometry args={[0.15, 0.38, 0.18]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Legs */}
      <mesh position={[-0.15, -0.2, 0]} castShadow>
        <boxGeometry args={[0.18, 0.22, 0.2]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.15, -0.2, 0]} castShadow>
        <boxGeometry args={[0.18, 0.22, 0.2]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Paws */}
      <mesh position={[-0.32, -0.08, 0]}>
        <boxGeometry args={[0.08, 0.08, 0.1]} />
        <meshStandardMaterial color={COLORS.bodyLight} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.32, -0.08, 0]}>
        <boxGeometry args={[0.08, 0.08, 0.1]} />
        <meshStandardMaterial color={COLORS.bodyLight} flatShading roughness={0.8} />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]} receiveShadow>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelBear;
