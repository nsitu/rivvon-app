export function dragAndDrop(handleFile) {

  const preventDefaults = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const highlight = () => {
    document.body.classList.add('hover');
  };

  const unhighlight = () => {
    document.body.classList.remove('hover');
  };

  const handleDrop = (e) => {
    preventDefaults(e);
    handleFile(e.dataTransfer.files[0]);
  };

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    document.body.addEventListener(eventName, highlight, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    document.body.addEventListener(eventName, unhighlight, false);
  });

  document.body.addEventListener('drop', handleDrop, false);


}