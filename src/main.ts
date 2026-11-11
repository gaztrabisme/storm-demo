const app = document.getElementById('app');
if (app) {
  const title = document.createElement('h1');
  title.dataset.test = 'title';
  title.textContent = 'Bản đồ bão';
  app.replaceChildren(title);
}
