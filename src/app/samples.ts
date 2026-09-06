const base = import.meta.env.BASE_URL;

export const sampleOptions = [
  { id: 'photo', label: '照片', url: `${base}samples/sample-photo.jpg` },
  { id: 'cartoon', label: '像素角色', url: `${base}samples/sample-cartoon.png` }
];

export function sampleById(id: string | undefined) {
  return sampleOptions.find((sample) => sample.id === id);
}
