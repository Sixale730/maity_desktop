/**
 * VoxelWizard Character Component
 * Magical wizard with tall hat and robes
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelWizardProps {
  animate?: boolean;
}

const COLORS = {
  robe: '#7C3AED',
  robeLight: '#8B5CF6',
  robeDark: '#5B21B6',
  hat: '#7C3AED',
  stars: '#FFD700',
  skin: '#FFD7C4',
  beard: '#9CA3AF',
  beardDark: '#6B7280',
  eyes: '#000000',
};

export function VoxelWizard({ animate = false }: VoxelWizardProps) {
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
      {/* Tall pointed hat */}
      <mesh position={[0, 1.0, -0.02]} castShadow>
        <boxGeometry args={[0.35, 0.35, 0.3]} />
        <meshStandardMaterial color={COLORS.hat} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.25, -0.02]} castShadow>
        <boxGeometry args={[0.25, 0.25, 0.22]} />
        <meshStandardMaterial color={COLORS.hat} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.45, -0.02]} castShadow>
        <boxGeometry args={[0.15, 0.2, 0.14]} />
        <meshStandardMaterial color={COLORS.hat} flatShading roughness={0.8} />
      </mesh>

      {/* Hat brim */}
      <mesh position={[0, 0.82, 0]} castShadow>
        <boxGeometry args={[0.5, 0.06, 0.45]} />
        <meshStandardMaterial color={COLORS.robeDark} flatShading roughness={0.8} />
      </mesh>

      {/* Stars on hat */}
      <mesh position={[0.1, 1.1, 0.14]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshBasicMaterial color={COLORS.stars} />
      </mesh>
      <mesh position={[-0.08, 1.3, 0.1]}>
        <boxGeometry args={[0.05, 0.05, 0.02]} />
        <meshBasicMaterial color={COLORS.stars} />
      </mesh>

      {/* Face */}
      <mesh position={[0, 0.62, 0.12]} castShadow>
        <boxGeometry args={[0.35, 0.28, 0.25]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.08, 0.68, 0.25]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      <mesh position={[0.08, 0.68, 0.25]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>

      {/* Eyebrows */}
      <mesh position={[-0.08, 0.74, 0.25]}>
        <boxGeometry args={[0.08, 0.02, 0.02]} />
        <meshStandardMaterial color={COLORS.beard} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.08, 0.74, 0.25]}>
        <boxGeometry args={[0.08, 0.02, 0.02]} />
        <meshStandardMaterial color={COLORS.beard} flatShading roughness={0.8} />
      </mesh>

      {/* Nose */}
      <mesh position={[0, 0.6, 0.26]}>
        <boxGeometry args={[0.06, 0.08, 0.04]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Long beard */}
      <mesh position={[0, 0.4, 0.18]} castShadow>
        <boxGeometry args={[0.25, 0.25, 0.15]} />
        <meshStandardMaterial color={COLORS.beard} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.2, 0.2]} castShadow>
        <boxGeometry args={[0.2, 0.2, 0.12]} />
        <meshStandardMaterial color={COLORS.beardDark} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.05, 0.22]} castShadow>
        <boxGeometry args={[0.12, 0.15, 0.1]} />
        <meshStandardMaterial color={COLORS.beard} flatShading roughness={0.9} />
      </mesh>

      {/* Robe body */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.5, 0.6, 0.35]} />
        <meshStandardMaterial color={COLORS.robe} flatShading roughness={0.8} />
      </mesh>

      {/* Robe bottom (wider) */}
      <mesh position={[0, -0.25, 0]} castShadow>
        <boxGeometry args={[0.6, 0.15, 0.4]} />
        <meshStandardMaterial color={COLORS.robeDark} flatShading roughness={0.8} />
      </mesh>

      {/* Robe trim */}
      <mesh position={[0, 0.38, 0.18]} castShadow>
        <boxGeometry args={[0.08, 0.5, 0.04]} />
        <meshStandardMaterial color={COLORS.stars} flatShading roughness={0.8} />
      </mesh>

      {/* Sleeves */}
      <mesh position={[-0.32, 0.2, 0.05]} castShadow>
        <boxGeometry args={[0.18, 0.35, 0.2]} />
        <meshStandardMaterial color={COLORS.robeLight} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.32, 0.2, 0.05]} castShadow>
        <boxGeometry args={[0.18, 0.35, 0.2]} />
        <meshStandardMaterial color={COLORS.robeLight} flatShading roughness={0.8} />
      </mesh>

      {/* Hands */}
      <mesh position={[-0.32, 0.0, 0.05]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.32, 0.0, 0.05]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]} receiveShadow>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelWizard;
