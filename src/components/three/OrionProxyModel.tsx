import { type ThreeElements } from '@react-three/fiber';

type OrionProxyModelProps = ThreeElements['group'] & {
  unitScale?: number;
  isSelected?: boolean;
};

export function OrionProxyModel({
  unitScale = 1,
  isSelected = false,
  ...props
}: OrionProxyModelProps) {
  return (
    <group {...props} scale={unitScale}>
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.18, 0.42, 0.7, 16]} />
        <meshStandardMaterial
          color={isSelected ? '#e7edf8' : '#cfcfcf'}
          metalness={0.45}
          roughness={0.35}
          emissive={isSelected ? '#10151f' : '#000000'}
        />
      </mesh>

      <mesh position={[0, -0.18, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 0.9, 16]} />
        <meshStandardMaterial
          color="#e8e8e8"
          metalness={0.18}
          roughness={0.72}
        />
      </mesh>

      <mesh position={[0, -0.72, 0]}>
        <cylinderGeometry args={[0.16, 0.06, 0.22, 16]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.55} roughness={0.3} />
      </mesh>

      {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle, index) => (
        <group key={index} rotation={[0, angle, 0]} position={[0, -0.15, 0]}>
          <mesh position={[0.95, 0, 0]}>
            <boxGeometry args={[1.15, 0.22, 0.025]} />
            <meshStandardMaterial color="#10233f" metalness={0.2} roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
