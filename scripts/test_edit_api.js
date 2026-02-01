// using global fetch
// Actually, I'll use global fetch as per previous script fix

async function testEditApi() {
  const id = '65a12faac0ac0ff8bf18fde0'; // Known ID from previous output
  const url = `http://localhost:3000/api/ingredients/${id}`;
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

testEditApi();
