/**
 * VoxelPanda Character Component
 * Black and white panda bear
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelPandaProps {
  animate?: boolean;
}

const COLORS = {
  white: '#FFFFFF',
  black: '#1A1A1A',
  nose: '#000000',
  cheek: '#FFB6C1',
};

export function VoxelPanda({ animate = false }: VoxelPandaProps) {
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
      <mesh position={[0, 0.6, 0.05]} castShadow>
        <boxGeometry args={[0.55, 0.5, 0.45]} />
        <meshStandardMaterial color={COLORS.white} flatShading roughness={0.8} />
      </mesh>

      {/* Ears */}
      <mesh position={[-0.22, 0.88, 0]} castShadow>
        <boxGeometry args={[0.15, 0.15, 0.12]} />
        <meshStandardMaterial color={COLORS.black} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.22, 0.88, 0]} castShadow>
        <boxGeometry args={[0.15, 0.15, 0.12]} />
        <meshStandardMaterial color={COLORS.black} flatShading roughness={0.8} />
      </mesh>

      {/* Eye patches (iconic panda feature) */}
      <mesh position={[-0.12, 0.62, 0.22]} castShadow>
        <boxGeometry args={[0.18, 0.2, 0.06]} />
        <meshStandardMaterial color={COLORS.black} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.12, 0.62, 0.22]} castShadow>
        <boxGeometry args={[0.18, 0.2, 0.06]} />
        <meshStandardMaterial color={COLORS.black} flatShading roughness={0.8} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.12, 0.62, 0.26]}>
        <boxGeometry args={[0.08, 0.1, 0.02]} />
        <meshBasicMaterial color={COLORS.white} />
      </mesh>
      <mesh position={[0.12, 0.62, 0.26]}>
        <boxGeometry args={[0.08, 0.1, 0.02]} />
        <meshBasicMaterial color={COLORS.white} />
      </mesh>

      {/* Pupils */}
      <mesh position={[-0.12, 0.62, 0.28]}>
        <boxGeometry args={[0.04, 0.06, 0.02]} />
        <meshBasicMaterial color={COLORS.black} />
      </mesh>
      <mesh position={[0.12, 0.62, 0.28]}>
        <boxGeometry args={[0.04, 0.06, 0.02]} />
        <meshBasicMaterial color={COLORS.black} />
      </mesh>

      {/* Nose */}
      <mesh position={[0, 0.5, 0.24]}>
        <boxGeometry args={[0.08, 0.06, 0.04]} />
        <meshStandardMaterial color={COLORS.nose} flatShading roughness={0.6} />
      </mesh>

      {/* Muzzle */}
      <mesh position={[0, 0.45, 0.18]} castShadow>
        <boxGeometry args={[0.2, 0.12, 0.15]} />
        <meshStandardMaterial color={COLORS.white} flatShading roughness={0.8} />
      </mesh>

      {/* Cheeks */}
      <mesh position={[-0.2, 0.5, 0.2]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshStandardMaterial color={COLORS.cheek} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.2, 0.5, 0.2]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshStandardMaterial color={COLORS.cheek} flatShading roughness={0.8} />
      </mesh>

      {/* Body */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.55, 0.5, 0.45]} />
        <meshStandardMaterial color={COLORS.white} flatShading roughness={0.8} />
      </mesh>

      {/* Arms */}
      <mesh position={[-0.32, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.35, 0.18]} />
        <meshStandardMaterial color={COLORS.black} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.32, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.35, 0.18]} />
        <meshStandardMaterial color={COLORS.black} flatShading roughness={0.8} />
      </mesh>

      {/* Legs */}
      <mesh position={[-0.15, -0.2, 0]} castShadow>
        <boxGeometry args={[0.18, 0.2, 0.22]} />
        <meshStandardMaterial color={COLORS.black} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.15, -0.2, 0]} castShadow>
        <boxGeometry args={[0.18, 0.2, 0.22]} />
        <meshStandardMaterial color={COLORS.black} flatShading roughness={0.8} />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.29, 0]} receiveShadow>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelPanda;
