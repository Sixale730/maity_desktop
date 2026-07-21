/**
 * VoxelCat Character Component
 * Orange cat with triangular ears and long tail
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelCatProps {
  animate?: boolean;
}

const COLORS = {
  body: '#FF9800',
  bodyLight: '#FFB74D',
  belly: '#FFFFFF',
  nose: '#FFB6C1',
  eyes: '#4CAF50',
  eyePupil: '#000000',
  whiskers: '#4A4A4A',
};

export function VoxelCat({ animate = false }: VoxelCatProps) {
  const groupRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      groupRef.current.position.y = Math.sin(time * 2.5) * 0.03;
      groupRef.current.rotation.y = Math.sin(time * 1.2) * 0.06;
    }
    if (animate && tailRef.current) {
      const time = state.clock.getElapsedTime();
      tailRef.current.rotation.z = Math.sin(time * 3) * 0.3;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Head */}
      <mesh position={[0, 0.55, 0.1]} castShadow>
        <boxGeometry args={[0.45, 0.4, 0.35]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Ears */}
      <mesh position={[-0.15, 0.82, 0.1]} rotation={[0, 0, -0.3]} castShadow>
        <boxGeometry args={[0.12, 0.18, 0.08]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.15, 0.82, 0.1]} rotation={[0, 0, 0.3]} castShadow>
        <boxGeometry args={[0.12, 0.18, 0.08]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Inner ears */}
      <mesh position={[-0.15, 0.8, 0.14]} rotation={[0, 0, -0.3]}>
        <boxGeometry args={[0.06, 0.1, 0.02]} />
        <meshStandardMaterial color={COLORS.nose} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.15, 0.8, 0.14]} rotation={[0, 0, 0.3]}>
        <boxGeometry args={[0.06, 0.1, 0.02]} />
        <meshStandardMaterial color={COLORS.nose} flatShading roughness={0.8} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.1, 0.58, 0.28]}>
        <boxGeometry args={[0.1, 0.12, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      <mesh position={[0.1, 0.58, 0.28]}>
        <boxGeometry args={[0.1, 0.12, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>

      {/* Pupils */}
      <mesh position={[-0.1, 0.58, 0.3]}>
        <boxGeometry args={[0.04, 0.08, 0.02]} />
        <meshBasicMaterial color={COLORS.eyePupil} />
      </mesh>
      <mesh position={[0.1, 0.58, 0.3]}>
        <boxGeometry args={[0.04, 0.08, 0.02]} />
        <meshBasicMaterial color={COLORS.eyePupil} />
      </mesh>

      {/* Nose */}
      <mesh position={[0, 0.48, 0.28]}>
        <boxGeometry args={[0.06, 0.04, 0.03]} />
        <meshStandardMaterial color={COLORS.nose} flatShading roughness={0.6} />
      </mesh>

      {/* Muzzle */}
      <mesh position={[0, 0.44, 0.22]} castShadow>
        <boxGeometry args={[0.15, 0.08, 0.12]} />
        <meshStandardMaterial color={COLORS.belly} flatShading roughness={0.8} />
      </mesh>

      {/* Body */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.4, 0.4, 0.5]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Belly */}
      <mesh position={[0, 0.15, 0.2]} castShadow>
        <boxGeometry args={[0.25, 0.3, 0.15]} />
        <meshStandardMaterial color={COLORS.belly} flatShading roughness={0.8} />
      </mesh>

      {/* Front legs */}
      <mesh position={[-0.12, -0.15, 0.1]} castShadow>
        <boxGeometry args={[0.12, 0.25, 0.12]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.12, -0.15, 0.1]} castShadow>
        <boxGeometry args={[0.12, 0.25, 0.12]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Back legs */}
      <mesh position={[-0.12, -0.15, -0.15]} castShadow>
        <boxGeometry args={[0.12, 0.25, 0.12]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.12, -0.15, -0.15]} castShadow>
        <boxGeometry args={[0.12, 0.25, 0.12]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Paws */}
      <mesh position={[-0.12, -0.28, 0.1]}>
        <boxGeometry args={[0.1, 0.04, 0.1]} />
        <meshStandardMaterial color={COLORS.bodyLight} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.12, -0.28, 0.1]}>
        <boxGeometry args={[0.1, 0.04, 0.1]} />
        <meshStandardMaterial color={COLORS.bodyLight} flatShading roughness={0.8} />
      </mesh>

      {/* Tail */}
      <mesh ref={tailRef} position={[0, 0.2, -0.35]} rotation={[0.5, 0, 0]} castShadow>
        <boxGeometry args={[0.08, 0.35, 0.08]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Tail tip */}
      <mesh position={[0, 0.4, -0.5]} castShadow>
        <boxGeometry args={[0.07, 0.1, 0.07]} />
        <meshStandardMaterial color={COLORS.bodyLight} flatShading roughness={0.8} />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.29, 0]} receiveShadow>
        <circleGeometry args={[0.35, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelCat;
