/**
 * VoxelFrog Character Component
 * Green frog with bulging eyes
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelFrogProps {
  animate?: boolean;
}

const COLORS = {
  body: '#22C55E',
  bodyLight: '#4ADE80',
  belly: '#86EFAC',
  eyes: '#FEF08A',
  eyePupil: '#000000',
  mouth: '#15803D',
};

export function VoxelFrog({ animate = false }: VoxelFrogProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      groupRef.current.position.y = Math.sin(time * 3) * 0.04;
      groupRef.current.rotation.y = Math.sin(time * 1.5) * 0.08;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Head/Body (frogs have merged head-body) */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.6, 0.35, 0.5]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Belly */}
      <mesh position={[0, 0.15, 0.2]} castShadow>
        <boxGeometry args={[0.45, 0.25, 0.15]} />
        <meshStandardMaterial color={COLORS.belly} flatShading roughness={0.8} />
      </mesh>

      {/* Bulging eyes - left */}
      <mesh position={[-0.18, 0.48, 0.1]} castShadow>
        <boxGeometry args={[0.18, 0.2, 0.18]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[-0.18, 0.5, 0.2]}>
        <boxGeometry args={[0.14, 0.16, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      <mesh position={[-0.18, 0.5, 0.22]}>
        <boxGeometry args={[0.06, 0.1, 0.02]} />
        <meshBasicMaterial color={COLORS.eyePupil} />
      </mesh>

      {/* Bulging eyes - right */}
      <mesh position={[0.18, 0.48, 0.1]} castShadow>
        <boxGeometry args={[0.18, 0.2, 0.18]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.18, 0.5, 0.2]}>
        <boxGeometry args={[0.14, 0.16, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      <mesh position={[0.18, 0.5, 0.22]}>
        <boxGeometry args={[0.06, 0.1, 0.02]} />
        <meshBasicMaterial color={COLORS.eyePupil} />
      </mesh>

      {/* Mouth (wide smile) */}
      <mesh position={[0, 0.12, 0.26]}>
        <boxGeometry args={[0.35, 0.04, 0.02]} />
        <meshStandardMaterial color={COLORS.mouth} flatShading roughness={0.8} />
      </mesh>

      {/* Nostrils */}
      <mesh position={[-0.06, 0.28, 0.26]}>
        <boxGeometry args={[0.03, 0.03, 0.02]} />
        <meshStandardMaterial color={COLORS.mouth} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.06, 0.28, 0.26]}>
        <boxGeometry args={[0.03, 0.03, 0.02]} />
        <meshStandardMaterial color={COLORS.mouth} flatShading roughness={0.8} />
      </mesh>

      {/* Front legs (webbed feet position) */}
      <mesh position={[-0.25, -0.05, 0.15]} castShadow>
        <boxGeometry args={[0.12, 0.2, 0.12]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.25, -0.05, 0.15]} castShadow>
        <boxGeometry args={[0.12, 0.2, 0.12]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Front feet */}
      <mesh position={[-0.25, -0.15, 0.22]}>
        <boxGeometry args={[0.15, 0.04, 0.12]} />
        <meshStandardMaterial color={COLORS.bodyLight} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.25, -0.15, 0.22]}>
        <boxGeometry args={[0.15, 0.04, 0.12]} />
        <meshStandardMaterial color={COLORS.bodyLight} flatShading roughness={0.8} />
      </mesh>

      {/* Back legs (bent, powerful) */}
      <mesh position={[-0.28, 0.05, -0.15]} rotation={[0.5, 0, 0]} castShadow>
        <boxGeometry args={[0.15, 0.25, 0.15]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.28, 0.05, -0.15]} rotation={[0.5, 0, 0]} castShadow>
        <boxGeometry args={[0.15, 0.25, 0.15]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.8} />
      </mesh>

      {/* Back feet */}
      <mesh position={[-0.28, -0.15, -0.08]}>
        <boxGeometry args={[0.18, 0.04, 0.2]} />
        <meshStandardMaterial color={COLORS.bodyLight} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.28, -0.15, -0.08]}>
        <boxGeometry args={[0.18, 0.04, 0.2]} />
        <meshStandardMaterial color={COLORS.bodyLight} flatShading roughness={0.8} />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelFrog;
