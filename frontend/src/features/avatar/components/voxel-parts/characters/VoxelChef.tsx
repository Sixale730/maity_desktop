/**
 * VoxelChef Character Component
 * Professional chef with tall hat
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelChefProps {
  animate?: boolean;
}

const COLORS = {
  uniform: '#FFFFFF',
  uniformLight: '#F5F5F5',
  buttons: '#1A1A1A',
  scarf: '#3B82F6',
  apron: '#F5F5F5',
  skin: '#FFD7C4',
  hair: '#3D2314',
  eyes: '#000000',
  mustache: '#5C4033',
};

export function VoxelChef({ animate = false }: VoxelChefProps) {
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
      {/* Chef hat (toque) */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[0.35, 0.45, 0.3]} />
        <meshStandardMaterial color={COLORS.uniform} flatShading roughness={0.9} />
      </mesh>

      {/* Hat pleats (decoration) */}
      <mesh position={[0, 1.2, 0.12]}>
        <boxGeometry args={[0.3, 0.3, 0.08]} />
        <meshStandardMaterial color={COLORS.uniformLight} flatShading roughness={0.9} />
      </mesh>

      {/* Hat band */}
      <mesh position={[0, 0.82, 0]} castShadow>
        <boxGeometry args={[0.38, 0.06, 0.32]} />
        <meshStandardMaterial color={COLORS.uniformLight} flatShading roughness={0.9} />
      </mesh>

      {/* Face */}
      <mesh position={[0, 0.62, 0.08]} castShadow>
        <boxGeometry args={[0.35, 0.32, 0.28]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.08, 0.68, 0.22]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      <mesh position={[0.08, 0.68, 0.22]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>

      {/* Eyebrows */}
      <mesh position={[-0.08, 0.73, 0.22]}>
        <boxGeometry args={[0.08, 0.02, 0.02]} />
        <meshStandardMaterial color={COLORS.hair} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.08, 0.73, 0.22]}>
        <boxGeometry args={[0.08, 0.02, 0.02]} />
        <meshStandardMaterial color={COLORS.hair} flatShading roughness={0.8} />
      </mesh>

      {/* Nose */}
      <mesh position={[0, 0.6, 0.23]}>
        <boxGeometry args={[0.06, 0.08, 0.04]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Mustache */}
      <mesh position={[0, 0.52, 0.22]}>
        <boxGeometry args={[0.15, 0.04, 0.03]} />
        <meshStandardMaterial color={COLORS.mustache} flatShading roughness={0.9} />
      </mesh>

      {/* Mouth (slight smile) */}
      <mesh position={[0, 0.48, 0.22]}>
        <boxGeometry args={[0.08, 0.02, 0.02]} />
        <meshStandardMaterial color="#C4A484" flatShading roughness={0.8} />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 0.42, 0.05]} castShadow>
        <boxGeometry args={[0.2, 0.08, 0.15]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Blue scarf/neckerchief */}
      <mesh position={[0, 0.38, 0.1]} castShadow>
        <boxGeometry args={[0.25, 0.1, 0.12]} />
        <meshStandardMaterial color={COLORS.scarf} flatShading roughness={0.7} />
      </mesh>

      {/* Chef jacket body */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.5, 0.55, 0.32]} />
        <meshStandardMaterial color={COLORS.uniform} flatShading roughness={0.9} />
      </mesh>

      {/* Double-breasted buttons */}
      <mesh position={[-0.08, 0.2, 0.17]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshStandardMaterial color={COLORS.buttons} flatShading roughness={0.6} />
      </mesh>
      <mesh position={[0.08, 0.2, 0.17]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshStandardMaterial color={COLORS.buttons} flatShading roughness={0.6} />
      </mesh>
      <mesh position={[-0.08, 0.08, 0.17]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshStandardMaterial color={COLORS.buttons} flatShading roughness={0.6} />
      </mesh>
      <mesh position={[0.08, 0.08, 0.17]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshStandardMaterial color={COLORS.buttons} flatShading roughness={0.6} />
      </mesh>

      {/* Apron */}
      <mesh position={[0, -0.05, 0.12]} castShadow>
        <boxGeometry args={[0.4, 0.35, 0.05]} />
        <meshStandardMaterial color={COLORS.apron} flatShading roughness={0.9} />
      </mesh>

      {/* Arms */}
      <mesh position={[-0.32, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.4, 0.18]} />
        <meshStandardMaterial color={COLORS.uniform} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0.32, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.4, 0.18]} />
        <meshStandardMaterial color={COLORS.uniform} flatShading roughness={0.9} />
      </mesh>

      {/* Hands */}
      <mesh position={[-0.32, -0.08, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.32, -0.08, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* Pants */}
      <mesh position={[-0.12, -0.22, 0]} castShadow>
        <boxGeometry args={[0.15, 0.25, 0.18]} />
        <meshStandardMaterial color={COLORS.buttons} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.12, -0.22, 0]} castShadow>
        <boxGeometry args={[0.15, 0.25, 0.18]} />
        <meshStandardMaterial color={COLORS.buttons} flatShading roughness={0.8} />
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

export default VoxelChef;
