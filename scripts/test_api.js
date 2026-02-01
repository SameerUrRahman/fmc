// using global fetch (Node 18+)

async function testIngredients() {
  const url = process.env.API_URL || 'http://localhost:3000/api/ingredients';
  console.log(`Testing GET ${url}...`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
        console.error(`Error: ${res.status} ${res.statusText}`);
        const text = await res.text();
        console.error(text);
        return;
    }
    const data = await res.json();
    console.log('Success! Data received:');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to fetch:', err.message);
  }
}

testIngredients();
